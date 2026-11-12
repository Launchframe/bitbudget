use super::*;
use bitcoin::{
    Amount, OutPoint, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Txid, Witness, absolute,
    consensus::{deserialize, serialize},
    hashes::Hash,
    taproot::{LeafVersion, TapLeafHash},
    transaction,
};
use secp256k1::{Secp256k1, XOnlyPublicKey, schnorr::Signature};
use unified::{SpendContext, UnifiedSighash};

const IDS: [Participant; 3] = [Participant::A, Participant::B, Participant::C];

fn dkg_rounds() -> (
    Vec<(Participant, DkgRound2)>,
    BTreeMap<Participant, Round2Messages>,
) {
    let starts: Vec<_> = IDS
        .into_iter()
        .map(|id| (id, DkgRound1::start(id).unwrap()))
        .collect();
    let broadcasts: Vec<_> = starts
        .iter()
        .map(|(id, state)| (*id, state.broadcast().unwrap()))
        .collect();
    let mut states = Vec::new();
    let mut incoming: BTreeMap<_, Vec<_>> = BTreeMap::new();
    for (id, state) in starts {
        let messages = broadcasts
            .iter()
            .filter(|(peer, _)| *peer != id)
            .cloned()
            .collect();
        let (state, outgoing) = state.advance(messages).unwrap();
        states.push((id, state));
        for (recipient, bytes) in outgoing {
            incoming.entry(recipient).or_default().push((id, bytes));
        }
    }
    assert!(
        states
            .iter()
            .all(|(_, state)| state.broadcast_digest() == states[0].1.broadcast_digest())
    );
    (states, incoming)
}

fn dkg() -> BTreeMap<Participant, WalletShare> {
    let (states, mut incoming) = dkg_rounds();
    states
        .into_iter()
        .map(|(id, state)| (id, state.finish(incoming.remove(&id).unwrap()).unwrap()))
        .collect()
}

fn signing(
    shares: &BTreeMap<Participant, WalletShare>,
    pair: [Participant; 2],
    digest: [u8; 32],
) -> (SigningSession, Vec<(Participant, Vec<u8>)>) {
    let nonces: Vec<_> = pair
        .into_iter()
        .map(|id| (id, shares[&id].commit(digest, pair).unwrap()))
        .collect();
    let commitments = nonces
        .iter()
        .map(|(id, nonce)| (*id, nonce.commitment().unwrap()))
        .collect();
    let session = SigningSession::new(digest, commitments).unwrap();
    let session = SigningSession::deserialize(&session.serialize().unwrap()).unwrap();
    let signatures = nonces
        .into_iter()
        .map(|(id, nonce)| (id, nonce.sign(&shares[&id], &session).unwrap()))
        .collect();
    (session, signatures)
}

fn verify_independent(public: &PublicPackage, digest: [u8; 32], signature: [u8; 64]) {
    let key = XOnlyPublicKey::from_byte_array(public.output_key().unwrap()).unwrap();
    Secp256k1::verification_only()
        .verify_schnorr(&Signature::from_byte_array(signature), &digest, &key)
        .unwrap();
}

fn transaction() -> (Transaction, Vec<TxOut>) {
    let input = |byte| TxIn {
        previous_output: OutPoint {
            txid: Txid::from_byte_array([byte; 32]),
            vout: 1,
        },
        script_sig: ScriptBuf::new(),
        sequence: Sequence(0xfffffffd),
        witness: Witness::new(),
    };
    let output = TxOut {
        value: Amount::from_sat(12000),
        script_pubkey: ScriptBuf::from_bytes(vec![0x51]),
    };
    (
        Transaction {
            version: transaction::Version::TWO,
            lock_time: absolute::LockTime::from_consensus(500001),
            input: vec![input(1), input(2)],
            output: vec![output.clone(), output.clone()],
        },
        vec![output.clone(), output],
    )
}

#[test]
fn child_packages_preserve_roots_and_all_pairs_sign() {
    use bitcoin::key::TapTweak;

    let roots = dkg();
    let public = roots[&Participant::A].public_package();
    let encoded = public.serialize().unwrap();
    let mut outputs = std::collections::BTreeSet::new();
    for merkle_root in [[1; 32], [2; 32], [255; 32]] {
        let child_public = public.derive_child(&merkle_root).unwrap();
        let child: BTreeMap<_, _> = roots
            .iter()
            .map(|(id, share)| (*id, share.derive_child(&merkle_root).unwrap()))
            .collect();
        let root_key =
            bitcoin::secp256k1::XOnlyPublicKey::from_slice(&public.output_key().unwrap()).unwrap();
        let expected = root_key
            .tap_tweak(
                &bitcoin::secp256k1::Secp256k1::verification_only(),
                Some(bitcoin::taproot::TapNodeHash::from_byte_array(merkle_root)),
            )
            .0
            .to_x_only_public_key()
            .serialize();
        assert_eq!(child_public.output_key().unwrap(), expected);
        assert!(outputs.insert(expected));
        for share in child.values() {
            assert_eq!(
                share.public_package().serialize().unwrap(),
                child_public.serialize().unwrap()
            );
        }
        for pair in [
            [Participant::A, Participant::B],
            [Participant::A, Participant::C],
            [Participant::B, Participant::C],
        ] {
            let digest = [42; 32];
            let (session, parts) = signing(&child, pair, digest);
            let signature = session.aggregate(&child_public, parts).unwrap();
            verify_independent(&child_public, digest, signature);
            assert!(public.verify(&digest, &signature).is_err());
            assert!(
                public
                    .derive_child(&[3; 32])
                    .unwrap()
                    .verify(&digest, &signature)
                    .is_err()
            );
            let nonce = roots[&pair[0]].commit(digest, pair).unwrap();
            assert!(nonce.sign(&child[&pair[0]], &session).is_err());
        }
        assert_eq!(public.serialize().unwrap(), encoded);
    }
}

#[test]
fn durable_dkg_state_roundtrips_and_rejects_wrong_context() {
    let starts: Vec<_> = IDS
        .into_iter()
        .map(|id| {
            let state = DkgRound1::start(id).unwrap();
            let broadcast = state.broadcast().unwrap();
            let encoded = state.export_secret_state().unwrap();
            assert!(DkgRound1::restore_secret_state(IDS[(id as usize) % 3], &encoded).is_err());
            let mut trailing = encoded.to_vec();
            trailing.push(0);
            assert!(DkgRound1::restore_secret_state(id, &trailing).is_err());
            assert!(DkgRound2::restore_secret_state(id, &encoded).is_err());
            let restored = DkgRound1::restore_secret_state(id, &encoded).unwrap();
            assert_eq!(restored.broadcast().unwrap(), broadcast);
            (id, restored, broadcast)
        })
        .collect();
    let broadcasts: Vec<_> = starts
        .iter()
        .map(|(id, _, bytes)| (*id, bytes.clone()))
        .collect();
    let mut incoming: BTreeMap<Participant, Round2Messages> = BTreeMap::new();
    let mut states = Vec::new();
    for (id, state, _) in starts {
        let (state, outgoing) = state
            .advance(
                broadcasts
                    .iter()
                    .filter(|(peer, _)| *peer != id)
                    .cloned()
                    .collect(),
            )
            .unwrap();
        let digest = state.broadcast_digest();
        let encoded = state.export_secret_state().unwrap();
        assert!(DkgRound2::restore_secret_state(IDS[(id as usize) % 3], &encoded).is_err());
        assert!(DkgRound1::restore_secret_state(id, &encoded).is_err());
        let restored = DkgRound2::restore_secret_state(id, &encoded).unwrap();
        assert_eq!(restored.broadcast_digest(), digest);
        states.push((id, restored));
        for (recipient, bytes) in outgoing {
            incoming.entry(recipient).or_default().push((id, bytes));
        }
    }
    let shares: BTreeMap<_, _> = states
        .into_iter()
        .map(|(id, state)| (id, state.finish(incoming.remove(&id).unwrap()).unwrap()))
        .collect();
    for pair in [[IDS[0], IDS[1]], [IDS[0], IDS[2]], [IDS[1], IDS[2]]] {
        let (session, partials) = signing(&shares, pair, [71; 32]);
        let signature = session
            .aggregate(shares[&IDS[0]].public_package(), partials)
            .unwrap();
        verify_independent(shares[&IDS[0]].public_package(), [71; 32], signature);
    }
    for malformed in [vec![], vec![0; 32], vec![0; 16_385]] {
        assert!(DkgRound1::restore_secret_state(Participant::B, &malformed).is_err());
        assert!(DkgRound2::restore_secret_state(Participant::B, &malformed).is_err());
    }
}

#[test]
fn bitcoin_keypath_modes_and_witness_encoding() {
    let (tx, spent) = transaction();
    let shares = dkg();
    let public = shares[&IDS[0]].public_package();
    let default = taproot::keypath_digest(&tx, &spent, 0, 0).unwrap();
    let all = taproot::keypath_digest(&tx, &spent, 0, 1).unwrap();
    assert_ne!(default, all);
    assert_ne!(
        default,
        UnifiedSighash::new(&tx, &spent)
            .unwrap()
            .digest(0, SpendContext::KeyPath { annex: None })
            .unwrap()
    );
    for kind in [0, 1] {
        let digest = taproot::keypath_digest(&tx, &spent, 0, kind).unwrap();
        let (session, signatures) = signing(&shares, [IDS[0], IDS[1]], digest);
        let signature = session.aggregate(public, signatures).unwrap();
        verify_independent(public, digest, signature);
        let signed = taproot::finalize_keypath(tx.clone(), 0, &signature, kind).unwrap();
        assert_eq!(
            signed.input[0].witness.nth(0).unwrap().len(),
            64 + usize::from(kind)
        );
        assert_eq!(
            deserialize::<Transaction>(&serialize(&signed)).unwrap(),
            signed
        );
        assert!(taproot::finalize_keypath(signed, 0, &signature, kind).is_err());
    }
    assert!(taproot::keypath_digest(&tx, &spent[..1], 0, 0).is_err());
    assert!(taproot::keypath_digest(&tx, &spent, 2, 0).is_err());
    for kind in [2, 3, 0x21, 0x81] {
        assert!(taproot::keypath_digest(&tx, &spent, 0, kind).is_err());
        assert!(taproot::finalize_keypath(tx.clone(), 0, &[0; 64], kind).is_err());
    }
}

#[test]
fn real_dkg_all_three_pairs_bip340_and_unified_transaction() {
    let shares = dkg();
    let public = shares[&Participant::A].public_package();
    for share in shares.values() {
        assert_eq!(
            public.serialize().unwrap(),
            share.public_package().serialize().unwrap()
        );
    }
    let (tx, mut spent) = transaction();
    let mut script = vec![0x51, 0x20];
    script.extend(public.output_key().unwrap());
    for output in &mut spent {
        output.script_pubkey = ScriptBuf::from_bytes(script.clone());
    }
    let digest = UnifiedSighash::new(&tx, &spent)
        .unwrap()
        .digest(0, SpendContext::KeyPath { annex: None })
        .unwrap();
    for pair in [[IDS[0], IDS[1]], [IDS[0], IDS[2]], [IDS[1], IDS[2]]] {
        let (session, signatures) = signing(&shares, pair, digest);
        let signature = session.aggregate(public, signatures).unwrap();
        public.verify(&digest, &signature).unwrap();
        verify_independent(public, digest, signature);
        let witness_signature = unified::encode_unified_signature(signature);
        assert_eq!(witness_signature[64], 0x21);
        let mut signed_tx = tx.clone();
        signed_tx.input[0].witness.push(witness_signature);
        assert_eq!(
            deserialize::<Transaction>(&serialize(&signed_tx)).unwrap(),
            signed_tx
        );
        let mut tampered = digest;
        tampered[0] ^= 1;
        assert!(public.verify(&tampered, &signature).is_err());
    }
}

#[test]
fn one_duplicate_and_wrong_signature_shares_fail() {
    let shares = dkg();
    let public = shares[&IDS[0]].public_package();
    let pair = [IDS[0], IDS[1]];
    let (session, signatures) = signing(&shares, pair, [42; 32]);
    assert!(
        session
            .aggregate(public, vec![signatures[0].clone()])
            .is_err()
    );
    assert!(
        session
            .aggregate(public, vec![signatures[0].clone(), signatures[0].clone()])
            .is_err()
    );
    let mut wrong_id = signatures.clone();
    wrong_id[1].0 = IDS[2];
    assert!(session.aggregate(public, wrong_id).is_err());
    let (_, other_signature) = signing(&shares, pair, [42; 32]);
    assert!(
        session
            .aggregate(
                public,
                vec![signatures[0].clone(), other_signature[1].clone()]
            )
            .is_err()
    );
    let alien = dkg();
    let (_, alien_signature) = signing(&alien, pair, [42; 32]);
    assert!(session.aggregate(public, alien_signature).is_err());
    let mut corrupt = signatures;
    corrupt[1].1[0] ^= 1;
    assert!(session.aggregate(public, corrupt).is_err());
}

#[test]
fn nonce_and_transcript_binding_and_freshness() {
    let shares = dkg();
    let a = &shares[&IDS[0]];
    let b = &shares[&IDS[1]];
    let pair = [IDS[0], IDS[1]];
    assert!(a.commit([1; 32], [IDS[0], IDS[0]]).is_err());
    assert!(a.commit([1; 32], [IDS[1], IDS[2]]).is_err());
    let first = a.commit([1; 32], pair).unwrap();
    let second = a.commit([1; 32], pair).unwrap();
    assert_ne!(first.commitment().unwrap(), second.commitment().unwrap());
    let b_nonce = b.commit([1; 32], pair).unwrap();
    let commitments = vec![
        (IDS[0], first.commitment().unwrap()),
        (IDS[1], b_nonce.commitment().unwrap()),
    ];
    assert!(SigningSession::new([1; 32], vec![commitments[0].clone()]).is_err());
    assert!(
        SigningSession::new(
            [1; 32],
            vec![commitments[0].clone(), commitments[0].clone()]
        )
        .is_err()
    );
    let changed_message = SigningSession::new([2; 32], commitments.clone()).unwrap();
    assert!(first.sign(a, &changed_message).is_err());
    let session = SigningSession::new([1; 32], commitments).unwrap();
    assert!(second.sign(a, &session).is_err());
    assert!(b_nonce.sign(a, &session).is_err());
    let nonce = a.commit([1; 32], pair).unwrap();
    let c_nonce = shares[&IDS[2]].commit([1; 32], [IDS[0], IDS[2]]).unwrap();
    let wrong_pair = SigningSession::new(
        [1; 32],
        vec![
            (IDS[0], nonce.commitment().unwrap()),
            (IDS[2], c_nonce.commitment().unwrap()),
        ],
    )
    .unwrap();
    assert!(nonce.sign(a, &wrong_pair).is_err());
    let (one, sig_one) = signing(&shares, pair, [1; 32]);
    let (two, sig_two) = signing(&shares, pair, [1; 32]);
    assert_ne!(
        one.aggregate(a.public_package(), sig_one).unwrap(),
        two.aggregate(a.public_package(), sig_two).unwrap()
    );
}

#[test]
fn dkg_rejects_missing_duplicate_wrong_sender_and_tampered_packages() {
    let start = DkgRound1::start(IDS[0]).unwrap();
    assert!(start.advance(vec![]).is_err());
    let b = DkgRound1::start(IDS[1]).unwrap().broadcast().unwrap();
    assert!(
        DkgRound1::start(IDS[0])
            .unwrap()
            .advance(vec![(IDS[1], b.clone()), (IDS[1], b.clone())])
            .is_err()
    );
    let c = DkgRound1::start(IDS[2]).unwrap().broadcast().unwrap();
    assert!(
        DkgRound1::start(IDS[0])
            .unwrap()
            .advance(vec![(IDS[2], b.clone()), (IDS[1], c.clone())])
            .is_err()
    );
    let mut tampered = b;
    let end = tampered.len() - 1;
    tampered[end] ^= 1;
    assert!(
        DkgRound1::start(IDS[0])
            .unwrap()
            .advance(vec![(IDS[1], tampered), (IDS[2], c)])
            .is_err()
    );
    let (states, mut incoming) = dkg_rounds();
    let (id, state) = states.into_iter().next().unwrap();
    let mut messages = incoming.remove(&id).unwrap();
    messages[0].1[0] ^= 1;
    assert!(state.finish(messages).is_err());
    let (states, mut incoming) = dkg_rounds();
    let (_, state) = states.into_iter().next().unwrap();
    let mut messages = incoming.remove(&IDS[0]).unwrap();
    let wrong_recipient_package = incoming
        .remove(&IDS[2])
        .unwrap()
        .into_iter()
        .find(|(id, _)| *id == IDS[1])
        .unwrap();
    messages[0] = wrong_recipient_package;
    assert!(state.finish(messages).is_err());
}

#[test]
fn serialization_round_trip_and_wrong_wallet_or_identity_rejected() {
    let shares = dkg();
    let mut restored = BTreeMap::new();
    for (id, share) in &shares {
        let public =
            PublicPackage::deserialize(&share.public_package().serialize().unwrap()).unwrap();
        let secret = share.export_secret_share().unwrap();
        assert!(
            WalletShare::import_secret_share(IDS[(*id as usize) % 3], &secret, public.clone())
                .is_err()
        );
        restored.insert(
            *id,
            WalletShare::import_secret_share(*id, &secret, public).unwrap(),
        );
    }
    let (session, signatures) = signing(&restored, [IDS[1], IDS[2]], [7; 32]);
    let public = restored[&IDS[0]].public_package();
    verify_independent(
        public,
        [7; 32],
        session.aggregate(public, signatures).unwrap(),
    );
    let alien = dkg();
    assert!(
        WalletShare::import_secret_share(
            IDS[0],
            &shares[&IDS[0]].export_secret_share().unwrap(),
            alien[&IDS[0]].public_package().clone()
        )
        .is_err()
    );
    assert!(PublicPackage::deserialize(&[0; 20]).is_err());
    assert!(SigningSession::deserialize(&[0; 20]).is_err());
}

fn assert_vectors(vectors: &[serde_json::Value]) {
    for vector in vectors {
        let script = ScriptBuf::from_bytes(hex::decode(vector[0].as_str().unwrap()).unwrap());
        let tx: Transaction =
            deserialize(&hex::decode(vector[1].as_str().unwrap()).unwrap()).unwrap();
        let spent: Vec<_> = vector[5]
            .as_array()
            .unwrap()
            .iter()
            .map(|output| TxOut {
                value: Amount::from_sat(output[0].as_u64().unwrap()),
                script_pubkey: ScriptBuf::from_bytes(
                    hex::decode(output[1].as_str().unwrap()).unwrap(),
                ),
            })
            .collect();
        let context = match vector[4].as_u64().unwrap() {
            0 => SpendContext::Legacy {
                script_code: &script,
            },
            1 => SpendContext::SegwitV0 {
                script_code: &script,
            },
            2 => SpendContext::KeyPath { annex: None },
            3 => SpendContext::Tapscript {
                annex: None,
                tapleaf_hash: TapLeafHash::from_script(&script, LeafVersion::TapScript),
                code_separator: u32::MAX,
            },
            _ => panic!("unexpected script type"),
        };
        let digest = UnifiedSighash::new(&tx, &spent)
            .unwrap()
            .digest_with_type(
                vector[2].as_u64().unwrap() as usize,
                vector[3].as_u64().unwrap() as u8,
                context,
            )
            .unwrap();
        assert_eq!(hex::encode(digest), vector[6].as_str().unwrap());
    }
}

#[test]
fn pinned_knots_all_166_offline_vectors() {
    let fixture = include_bytes!("unified-vectors.json");
    let header = format!("blob {}\0", fixture.len());
    let blob = [header.as_bytes(), fixture.as_slice()].concat();
    assert_eq!(
        hex::encode(bitcoin::hashes::sha1::Hash::hash(&blob).to_byte_array()),
        "7f6c9685bf913cba28a334ff5b2bd1b447d44d56"
    );
    let vectors: Vec<serde_json::Value> = serde_json::from_slice(fixture).unwrap();
    assert_eq!(vectors.len() - 1, 166);
    assert_eq!(vectors[0][0], "scriptCode");
    assert_vectors(&vectors[1..]);
}

#[test]
fn unified_commits_every_input_output_and_context_but_not_witness() {
    let (tx, spent) = transaction();
    let context = SpendContext::KeyPath { annex: None };
    let digest = |tx: &Transaction, spent: &[TxOut]| {
        UnifiedSighash::new(tx, spent)
            .unwrap()
            .digest(0, context)
            .unwrap()
    };
    let expected = digest(&tx, &spent);
    for index in 0..2 {
        let mut changed = tx.clone();
        changed.input[index].sequence = Sequence(7);
        assert_ne!(expected, digest(&changed, &spent));
        let mut changed = tx.clone();
        changed.input[index].previous_output.vout += 1;
        assert_ne!(expected, digest(&changed, &spent));
        let mut changed = tx.clone();
        changed.output[index].value = Amount::from_sat(1);
        assert_ne!(expected, digest(&changed, &spent));
        let mut changed = tx.clone();
        changed.output[index].script_pubkey = ScriptBuf::new();
        assert_ne!(expected, digest(&changed, &spent));
        let mut changed = spent.clone();
        changed[index].value = Amount::from_sat(1);
        assert_ne!(expected, digest(&tx, &changed));
        let mut changed = spent.clone();
        changed[index].script_pubkey = ScriptBuf::new();
        assert_ne!(expected, digest(&tx, &changed));
    }
    let mut changed = tx.clone();
    changed.input[0].witness.push([1; 64]);
    assert_eq!(expected, digest(&changed, &spent));
    let cache = UnifiedSighash::new(&tx, &spent).unwrap();
    assert_ne!(expected, cache.digest(1, context).unwrap());
    assert_ne!(
        expected,
        cache
            .digest(
                0,
                SpendContext::KeyPath {
                    annex: Some(&[0x50, 1])
                }
            )
            .unwrap()
    );
    let leaf = TapLeafHash::from_script(&ScriptBuf::from_bytes(vec![0x51]), LeafVersion::TapScript);
    let script_context = SpendContext::Tapscript {
        annex: None,
        tapleaf_hash: leaf,
        code_separator: u32::MAX,
    };
    assert_ne!(expected, cache.digest(0, script_context).unwrap());
    assert_ne!(
        cache.digest(0, script_context).unwrap(),
        cache
            .digest(
                0,
                SpendContext::Tapscript {
                    annex: None,
                    tapleaf_hash: leaf,
                    code_separator: 0
                }
            )
            .unwrap()
    );
    assert!(
        cache
            .digest(0, SpendContext::KeyPath { annex: Some(&[1]) })
            .is_err()
    );
    assert!(cache.digest(2, context).is_err());
    assert!(UnifiedSighash::new(&tx, &spent[..1]).is_err());
    for invalid in [0, 1, 0x20, 0x24, 0x61, 0xff] {
        assert!(cache.digest_with_type(0, invalid, context).is_err());
    }
    let preimage = cache.preimage(0, 0x21, context).unwrap();
    assert_eq!(&preimage[..6], &[0, 0x21, 2, 0, 0, 0]);
    assert_eq!(&preimage[6..11], &[0x21, 0xa1, 7, 0, 0]);
    let wire = serialize(&tx);
    assert_eq!(&wire[wire.len() - 4..], &[0x21, 0xa1, 7, 0]);
    assert_eq!(deserialize::<Transaction>(&wire).unwrap(), tx);
}

#[test]
fn unified_other_modes_single_out_of_range_and_script_domains() {
    let (tx, spent) = transaction();
    let context = SpendContext::KeyPath { annex: None };
    let cache = UnifiedSighash::new(&tx, &spent).unwrap();
    let hashes: std::collections::BTreeSet<_> = [0x21, 0x22, 0x23, 0xa1, 0xa2, 0xa3]
        .into_iter()
        .map(|kind| cache.digest_with_type(0, kind, context).unwrap())
        .collect();
    assert_eq!(hashes.len(), 6);
    let script = ScriptBuf::from_bytes(vec![0x51]);
    assert_ne!(
        cache
            .digest(
                0,
                SpendContext::Legacy {
                    script_code: &script
                }
            )
            .unwrap(),
        cache
            .digest(
                0,
                SpendContext::SegwitV0 {
                    script_code: &script
                }
            )
            .unwrap()
    );
    let mut no_output = tx.clone();
    no_output.output.clear();
    assert!(
        UnifiedSighash::new(&no_output, &spent)
            .unwrap()
            .digest_with_type(0, 0x23, context)
            .is_err()
    );
    let mut changed = tx.clone();
    changed.output[1].value = Amount::from_sat(1);
    let changed_cache = UnifiedSighash::new(&changed, &spent).unwrap();
    for kind in [0x22, 0x23] {
        assert_eq!(
            cache.digest_with_type(0, kind, context).unwrap(),
            changed_cache.digest_with_type(0, kind, context).unwrap()
        );
    }
}
