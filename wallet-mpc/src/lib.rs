use std::collections::BTreeMap;

use bitcoin::hashes::{Hash, HashEngine, sha256};
use frost_secp256k1_tr as frost;
use rand_core::OsRng;
use zeroize::Zeroizing;

mod dkg_state;
pub mod taproot;
pub mod unified;

#[cfg(feature = "wasm")]
mod wasm;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid participant roster or duplicate participant")]
    Roster,
    #[error("invalid or mismatched protocol transcript")]
    Transcript,
    #[error("invalid key share or public package")]
    Key,
    #[error("invalid transaction signing context")]
    Transaction,
    #[error("cryptographic operation failed")]
    Crypto(#[from] frost::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u16)]
pub enum Participant {
    A = 1,
    B = 2,
    C = 3,
}

impl TryFrom<u16> for Participant {
    type Error = Error;

    fn try_from(value: u16) -> Result<Self> {
        match value {
            1 => Ok(Self::A),
            2 => Ok(Self::B),
            3 => Ok(Self::C),
            _ => Err(Error::Roster),
        }
    }
}

impl Participant {
    fn id(self) -> frost::Identifier {
        (self as u16).try_into().expect("nonzero fixed participant")
    }
}

fn unique<T>(items: Vec<(Participant, T)>) -> Result<BTreeMap<frost::Identifier, T>> {
    let mut map = BTreeMap::new();
    for (participant, item) in items {
        if map.insert(participant.id(), item).is_some() {
            return Err(Error::Roster);
        }
    }
    Ok(map)
}

fn peers<T>(own: Participant, map: &BTreeMap<frost::Identifier, T>) -> Result<()> {
    if map.len() != 2 || map.contains_key(&own.id()) {
        return Err(Error::Roster);
    }
    Ok(())
}

pub struct DkgRound1 {
    participant: Participant,
    secret: frost::keys::dkg::round1::SecretPackage,
    broadcast: frost::keys::dkg::round1::Package,
}

pub struct DkgRound2 {
    participant: Participant,
    secret: frost::keys::dkg::round2::SecretPackage,
    transcript: BTreeMap<frost::Identifier, frost::keys::dkg::round1::Package>,
    broadcast_digest: [u8; 32],
}

pub type Round2Messages = Vec<(Participant, Zeroizing<Vec<u8>>)>;

impl DkgRound1 {
    pub fn start(participant: Participant) -> Result<Self> {
        let (secret, broadcast) = frost::keys::dkg::part1(participant.id(), 3, 2, OsRng)?;
        Ok(Self {
            participant,
            secret,
            broadcast,
        })
    }

    pub fn broadcast(&self) -> Result<Vec<u8>> {
        Ok(self.broadcast.serialize()?)
    }

    pub fn advance(
        self,
        broadcasts: Vec<(Participant, Vec<u8>)>,
    ) -> Result<(DkgRound2, Round2Messages)> {
        let transcript = unique(
            broadcasts
                .into_iter()
                .map(|(id, bytes)| {
                    Ok((id, frost::keys::dkg::round1::Package::deserialize(&bytes)?))
                })
                .collect::<Result<_>>()?,
        )?;
        peers(self.participant, &transcript)?;
        let mut engine = sha256::Hash::engine();
        engine.input(b"BitBudget/FROST-DKG/broadcast/v1");
        for participant in [Participant::A, Participant::B, Participant::C] {
            let package = if participant == self.participant {
                &self.broadcast
            } else {
                &transcript[&participant.id()]
            };
            let encoded = package.serialize()?;
            engine.input(&(participant as u16).to_le_bytes());
            engine.input(&(encoded.len() as u64).to_le_bytes());
            engine.input(&encoded);
        }
        let broadcast_digest = sha256::Hash::from_engine(engine).to_byte_array();
        let (secret, outgoing) = frost::keys::dkg::part2(self.secret, &transcript)?;
        let mut messages = Vec::new();
        for recipient in [Participant::A, Participant::B, Participant::C] {
            if let Some(package) = outgoing.get(&recipient.id()) {
                messages.push((recipient, Zeroizing::new(package.serialize()?)));
            }
        }
        Ok((
            DkgRound2 {
                participant: self.participant,
                secret,
                transcript,
                broadcast_digest,
            },
            messages,
        ))
    }
}

impl DkgRound2 {
    pub fn broadcast_digest(&self) -> [u8; 32] {
        self.broadcast_digest
    }

    pub fn finish(self, received: Round2Messages) -> Result<WalletShare> {
        let packages = unique(
            received
                .into_iter()
                .map(|(id, bytes)| {
                    Ok((id, frost::keys::dkg::round2::Package::deserialize(&bytes)?))
                })
                .collect::<Result<_>>()?,
        )?;
        peers(self.participant, &packages)?;
        let (key, public) = frost::keys::dkg::part3(&self.secret, &self.transcript, &packages)?;
        Ok(WalletShare {
            participant: self.participant,
            key,
            public: PublicPackage(public),
        })
    }
}

#[derive(Clone)]
pub struct PublicPackage(frost::keys::PublicKeyPackage);

impl PublicPackage {
    pub fn serialize(&self) -> Result<Vec<u8>> {
        Ok(self.0.serialize()?)
    }

    pub fn deserialize(bytes: &[u8]) -> Result<Self> {
        let public = frost::keys::PublicKeyPackage::deserialize(bytes)?;
        if public.verifying_shares().len() != 3
            || public.min_signers() != Some(2)
            || [Participant::A, Participant::B, Participant::C]
                .iter()
                .any(|id| !public.verifying_shares().contains_key(&id.id()))
        {
            return Err(Error::Key);
        }
        Ok(Self(public))
    }

    pub fn output_key(&self) -> Result<[u8; 32]> {
        let bytes = self.0.verifying_key().serialize()?;
        bytes[1..].try_into().map_err(|_| Error::Key)
    }

    pub fn verify(&self, digest: &[u8; 32], signature: &[u8; 64]) -> Result<()> {
        self.0
            .verifying_key()
            .verify(digest, &frost::Signature::deserialize(signature)?)?;
        Ok(())
    }
}

pub struct WalletShare {
    participant: Participant,
    key: frost::keys::KeyPackage,
    public: PublicPackage,
}

impl WalletShare {
    pub fn participant(&self) -> Participant {
        self.participant
    }

    pub fn public_package(&self) -> &PublicPackage {
        &self.public
    }

    pub fn export_secret_share(&self) -> Result<Zeroizing<Vec<u8>>> {
        Ok(Zeroizing::new(self.key.serialize()?))
    }

    pub fn import_secret_share(
        participant: Participant,
        bytes: &[u8],
        public: PublicPackage,
    ) -> Result<Self> {
        let key = frost::keys::KeyPackage::deserialize(bytes)?;
        if key.identifier() != &participant.id()
            || *key.min_signers() != 2
            || key.verifying_key() != public.0.verifying_key()
            || public.0.verifying_shares().get(&participant.id()) != Some(key.verifying_share())
            || frost::keys::VerifyingShare::from(*key.signing_share()) != *key.verifying_share()
        {
            return Err(Error::Key);
        }
        Ok(Self {
            participant,
            key,
            public,
        })
    }

    pub fn commit(&self, digest: [u8; 32], pair: [Participant; 2]) -> Result<SigningNonce> {
        if pair[0] == pair[1] || !pair.contains(&self.participant) {
            return Err(Error::Roster);
        }
        let (nonces, commitment) = frost::round1::commit(self.key.signing_share(), &mut OsRng);
        let mut pair = pair;
        pair.sort();
        Ok(SigningNonce {
            participant: self.participant,
            digest,
            pair,
            nonces,
            commitment,
            public_key: self.public.output_key()?,
        })
    }
}

pub struct SigningNonce {
    participant: Participant,
    digest: [u8; 32],
    pair: [Participant; 2],
    nonces: frost::round1::SigningNonces,
    commitment: frost::round1::SigningCommitments,
    public_key: [u8; 32],
}

impl SigningNonce {
    pub fn commitment(&self) -> Result<Vec<u8>> {
        Ok(self.commitment.serialize()?)
    }

    pub fn sign(self, share: &WalletShare, session: &SigningSession) -> Result<Vec<u8>> {
        if self.participant != share.participant
            || self.public_key != share.public.output_key()?
            || session.0.message().as_slice() != self.digest
            || session
                .0
                .signing_commitments()
                .keys()
                .copied()
                .collect::<Vec<_>>()
                != self.pair.map(Participant::id)
            || session.0.signing_commitments().get(&self.participant.id()) != Some(&self.commitment)
        {
            return Err(Error::Transcript);
        }
        Ok(frost::round2::sign(&session.0, &self.nonces, &share.key)?.serialize())
    }
}

pub struct SigningSession(frost::SigningPackage);

impl SigningSession {
    pub fn new(digest: [u8; 32], commitments: Vec<(Participant, Vec<u8>)>) -> Result<Self> {
        let commitments = unique(
            commitments
                .into_iter()
                .map(|(id, bytes)| {
                    Ok((id, frost::round1::SigningCommitments::deserialize(&bytes)?))
                })
                .collect::<Result<_>>()?,
        )?;
        if commitments.len() != 2 {
            return Err(Error::Roster);
        }
        Ok(Self(frost::SigningPackage::new(commitments, &digest)))
    }

    pub fn serialize(&self) -> Result<Vec<u8>> {
        Ok(self.0.serialize()?)
    }

    pub fn deserialize(bytes: &[u8]) -> Result<Self> {
        let package = frost::SigningPackage::deserialize(bytes)?;
        if package.message().len() != 32
            || package.signing_commitments().len() != 2
            || package.signing_commitments().keys().any(|id| {
                ![
                    Participant::A.id(),
                    Participant::B.id(),
                    Participant::C.id(),
                ]
                .contains(id)
            })
        {
            return Err(Error::Transcript);
        }
        Ok(Self(package))
    }

    pub fn aggregate(
        &self,
        public: &PublicPackage,
        shares: Vec<(Participant, Vec<u8>)>,
    ) -> Result<[u8; 64]> {
        let shares = unique(
            shares
                .into_iter()
                .map(|(id, bytes)| Ok((id, frost::round2::SignatureShare::deserialize(&bytes)?)))
                .collect::<Result<_>>()?,
        )?;
        if shares.len() != 2 || !shares.keys().eq(self.0.signing_commitments().keys()) {
            return Err(Error::Roster);
        }
        frost::aggregate(&self.0, &shares, &public.0)?
            .serialize()?
            .try_into()
            .map_err(|_| Error::Transcript)
    }
}

#[cfg(test)]
mod tests;
