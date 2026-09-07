use bitcoin::{
    ScriptBuf, Transaction, TxOut,
    consensus::{deserialize, serialize},
    secp256k1::{Message, Secp256k1, XOnlyPublicKey, schnorr::Signature},
    taproot::{LeafVersion, TapLeafHash},
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

use crate::{
    DkgRound1, DkgRound2, Error, Participant, PublicPackage, Round2Messages, SigningNonce,
    SigningSession, WalletShare,
    unified::{SpendContext, UnifiedSighash},
};

type JsResult<T> = std::result::Result<T, JsError>;

fn js(error: Error) -> JsError {
    JsError::new(&error.to_string())
}
fn participant(id: u16) -> JsResult<Participant> {
    Participant::try_from(id).map_err(js)
}
fn digest(bytes: &[u8]) -> JsResult<[u8; 32]> {
    bytes
        .try_into()
        .map_err(|_| JsError::new("digest must contain 32 bytes"))
}

#[wasm_bindgen]
pub struct WasmDkgRound1(DkgRound1);

#[wasm_bindgen]
impl WasmDkgRound1 {
    #[wasm_bindgen(constructor)]
    pub fn new(id: u16) -> JsResult<Self> {
        Ok(Self(DkgRound1::start(participant(id)?).map_err(js)?))
    }

    pub fn broadcast(&self) -> JsResult<Vec<u8>> {
        self.0.broadcast().map_err(js)
    }

    pub fn export_secret_state(self) -> JsResult<Vec<u8>> {
        Ok(self.0.export_secret_state().map_err(js)?.to_vec())
    }

    pub fn restore_secret_state(id: u16, bytes: &[u8]) -> JsResult<Self> {
        Ok(Self(
            DkgRound1::restore_secret_state(participant(id)?, bytes).map_err(js)?,
        ))
    }

    pub fn advance(
        self,
        peer_one: u16,
        package_one: &[u8],
        peer_two: u16,
        package_two: &[u8],
    ) -> JsResult<WasmDkgRound2> {
        let (state, outgoing) = self
            .0
            .advance(vec![
                (participant(peer_one)?, package_one.to_vec()),
                (participant(peer_two)?, package_two.to_vec()),
            ])
            .map_err(js)?;
        Ok(WasmDkgRound2 { state, outgoing })
    }
}

#[wasm_bindgen]
pub struct WasmDkgRound2 {
    state: DkgRound2,
    outgoing: Round2Messages,
}

#[wasm_bindgen]
impl WasmDkgRound2 {
    pub fn export_secret_state(self) -> JsResult<Vec<u8>> {
        if !self.outgoing.is_empty() {
            return Err(JsError::new(
                "Retrieve outgoing contributions before persisting DKG state",
            ));
        }
        Ok(self.state.export_secret_state().map_err(js)?.to_vec())
    }

    pub fn restore_secret_state(id: u16, bytes: &[u8]) -> JsResult<Self> {
        Ok(Self {
            state: DkgRound2::restore_secret_state(participant(id)?, bytes).map_err(js)?,
            outgoing: Vec::new(),
        })
    }

    pub fn broadcast_digest(&self) -> Vec<u8> {
        self.state.broadcast_digest().to_vec()
    }

    pub fn take_message(&mut self, recipient: u16) -> JsResult<Vec<u8>> {
        let recipient = participant(recipient)?;
        let index = self
            .outgoing
            .iter()
            .position(|(id, _)| *id == recipient)
            .ok_or_else(|| JsError::new("message absent or already taken"))?;
        Ok(self.outgoing.remove(index).1.to_vec())
    }

    pub fn finish(
        self,
        peer_one: u16,
        package_one: &[u8],
        peer_two: u16,
        package_two: &[u8],
    ) -> JsResult<WasmWalletShare> {
        Ok(WasmWalletShare(
            self.state
                .finish(vec![
                    (participant(peer_one)?, Zeroizing::new(package_one.to_vec())),
                    (participant(peer_two)?, Zeroizing::new(package_two.to_vec())),
                ])
                .map_err(js)?,
        ))
    }
}

#[wasm_bindgen]
pub struct WasmWalletShare(WalletShare);

#[wasm_bindgen]
impl WasmWalletShare {
    pub fn derive_child(&self, merkle_root: &[u8]) -> JsResult<WasmWalletShare> {
        Ok(Self(
            self.0.derive_child(&digest(merkle_root)?).map_err(js)?,
        ))
    }

    pub fn participant(&self) -> u16 {
        self.0.participant() as u16
    }
    pub fn public_package(&self) -> JsResult<Vec<u8>> {
        self.0.public_package().serialize().map_err(js)
    }
    pub fn output_key(&self) -> JsResult<Vec<u8>> {
        Ok(self.0.public_package().output_key().map_err(js)?.to_vec())
    }
    pub fn export_secret_share(&self) -> JsResult<Vec<u8>> {
        Ok(self.0.export_secret_share().map_err(js)?.to_vec())
    }

    pub fn import_secret_share(id: u16, secret: &[u8], public: &[u8]) -> JsResult<Self> {
        Ok(Self(
            WalletShare::import_secret_share(
                participant(id)?,
                secret,
                PublicPackage::deserialize(public).map_err(js)?,
            )
            .map_err(js)?,
        ))
    }

    #[wasm_bindgen(js_name = commit_digest_low_level)]
    pub fn commit(
        &self,
        message_digest: &[u8],
        other_participant: u16,
    ) -> JsResult<WasmSigningNonce> {
        Ok(WasmSigningNonce(
            self.0
                .commit(
                    digest(message_digest)?,
                    [self.0.participant(), participant(other_participant)?],
                )
                .map_err(js)?,
        ))
    }
}

#[wasm_bindgen]
pub struct WasmSigningNonce(SigningNonce);

#[wasm_bindgen]
impl WasmSigningNonce {
    pub fn commitment(&self) -> JsResult<Vec<u8>> {
        self.0.commitment().map_err(js)
    }
    pub fn sign(self, share: &WasmWalletShare, session: &WasmSigningSession) -> JsResult<Vec<u8>> {
        self.0.sign(&share.0, &session.0).map_err(js)
    }
}

#[wasm_bindgen]
pub struct WasmSigningSession(SigningSession);

#[wasm_bindgen]
impl WasmSigningSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        message_digest: &[u8],
        signer_one: u16,
        commitment_one: &[u8],
        signer_two: u16,
        commitment_two: &[u8],
    ) -> JsResult<Self> {
        Ok(Self(
            SigningSession::new(
                digest(message_digest)?,
                vec![
                    (participant(signer_one)?, commitment_one.to_vec()),
                    (participant(signer_two)?, commitment_two.to_vec()),
                ],
            )
            .map_err(js)?,
        ))
    }

    pub fn serialize(&self) -> JsResult<Vec<u8>> {
        self.0.serialize().map_err(js)
    }
    pub fn deserialize(package: &[u8]) -> JsResult<Self> {
        Ok(Self(SigningSession::deserialize(package).map_err(js)?))
    }

    pub fn aggregate(
        &self,
        public: &[u8],
        signer_one: u16,
        signature_one: &[u8],
        signer_two: u16,
        signature_two: &[u8],
    ) -> JsResult<Vec<u8>> {
        let public = PublicPackage::deserialize(public).map_err(js)?;
        Ok(self
            .0
            .aggregate(
                &public,
                vec![
                    (participant(signer_one)?, signature_one.to_vec()),
                    (participant(signer_two)?, signature_two.to_vec()),
                ],
            )
            .map_err(js)?
            .to_vec())
    }
}

#[wasm_bindgen]
pub fn derive_public_package(public: &[u8], merkle_root: &[u8]) -> JsResult<Vec<u8>> {
    PublicPackage::deserialize(public)
        .map_err(js)?
        .derive_child(&digest(merkle_root)?)
        .map_err(js)?
        .serialize()
        .map_err(js)
}

#[wasm_bindgen]
pub fn public_package_output_key(public: &[u8]) -> JsResult<Vec<u8>> {
    Ok(PublicPackage::deserialize(public)
        .map_err(js)?
        .output_key()
        .map_err(js)?
        .to_vec())
}

#[wasm_bindgen]
pub fn verify_signature(public: &[u8], message_digest: &[u8], signature: &[u8]) -> JsResult<()> {
    let signature: &[u8; 64] = signature
        .try_into()
        .map_err(|_| JsError::new("signature must contain 64 bytes"))?;
    let public = PublicPackage::deserialize(public).map_err(js)?;
    let digest = digest(message_digest)?;
    public.verify(&digest, signature).map_err(js)?;
    let key = XOnlyPublicKey::from_slice(&public.output_key().map_err(js)?)
        .map_err(|_| JsError::new("invalid x-only key"))?;
    let signature =
        Signature::from_slice(signature).map_err(|_| JsError::new("invalid BIP340 signature"))?;
    Secp256k1::verification_only()
        .verify_schnorr(&signature, &Message::from_digest(digest), &key)
        .map_err(|_| JsError::new("independent BIP340 verification failed"))
}

#[wasm_bindgen]
pub fn bitcoin_keypath_sighash(
    transaction: &[u8],
    spent_outputs: &[u8],
    input: u32,
    hash_type: u8,
) -> JsResult<Vec<u8>> {
    let transaction: Transaction =
        deserialize(transaction).map_err(|_| JsError::new("invalid Bitcoin wire transaction"))?;
    let spent: Vec<TxOut> =
        deserialize(spent_outputs).map_err(|_| JsError::new("invalid spent-output vector"))?;
    Ok(
        crate::taproot::keypath_digest(&transaction, &spent, input as usize, hash_type)
            .map_err(js)?
            .to_vec(),
    )
}

#[wasm_bindgen]
pub fn finalize_bitcoin_keypath(
    transaction: &[u8],
    input: u32,
    signature: &[u8],
    hash_type: u8,
) -> JsResult<Vec<u8>> {
    let transaction: Transaction =
        deserialize(transaction).map_err(|_| JsError::new("invalid Bitcoin wire transaction"))?;
    let signature = signature
        .try_into()
        .map_err(|_| JsError::new("signature must contain 64 bytes"))?;
    Ok(serialize(
        &crate::taproot::finalize_keypath(transaction, input as usize, signature, hash_type)
            .map_err(js)?,
    ))
}

#[wasm_bindgen]
pub struct WasmSpendContext {
    annex: Option<Vec<u8>>,
    script: Option<ScriptBuf>,
    code_separator: u32,
}

fn annex(bytes: &[u8]) -> JsResult<Option<Vec<u8>>> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes[0] != 0x50 {
        return Err(JsError::new("annex must begin with 0x50"));
    }
    Ok(Some(bytes.to_vec()))
}

#[wasm_bindgen]
impl WasmSpendContext {
    pub fn key_path(annex_bytes: &[u8]) -> JsResult<Self> {
        Ok(Self {
            annex: annex(annex_bytes)?,
            script: None,
            code_separator: u32::MAX,
        })
    }

    pub fn tapscript(script: &[u8], code_separator: u32, annex_bytes: &[u8]) -> JsResult<Self> {
        Ok(Self {
            annex: annex(annex_bytes)?,
            script: Some(ScriptBuf::from_bytes(script.to_vec())),
            code_separator,
        })
    }
}

#[wasm_bindgen]
pub fn unified_sighash(
    transaction: &[u8],
    spent_outputs: &[u8],
    input: u32,
    context: &WasmSpendContext,
) -> JsResult<Vec<u8>> {
    let tx: Transaction =
        deserialize(transaction).map_err(|_| JsError::new("invalid Bitcoin wire transaction"))?;
    let spent: Vec<TxOut> = deserialize(spent_outputs)
        .map_err(|_| JsError::new("invalid Bitcoin serialized spent-output vector"))?;
    let spend_context = match &context.script {
        Some(script) => SpendContext::Tapscript {
            annex: context.annex.as_deref(),
            tapleaf_hash: TapLeafHash::from_script(script, LeafVersion::TapScript),
            code_separator: context.code_separator,
        },
        None => SpendContext::KeyPath {
            annex: context.annex.as_deref(),
        },
    };
    Ok(UnifiedSighash::new(&tx, &spent)
        .map_err(js)?
        .digest(input as usize, spend_context)
        .map_err(js)?
        .to_vec())
}
