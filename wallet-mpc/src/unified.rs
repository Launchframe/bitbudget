use bitcoin::{
    Script, Transaction, TxOut,
    consensus::encode::serialize,
    hashes::{Hash, HashEngine, sha256},
    taproot::TapLeafHash,
};

use crate::{Error, Result};

pub const DEFAULT_HASH_TYPE: u8 = 0x21;

#[derive(Clone, Copy)]
pub enum SpendContext<'a> {
    Legacy {
        script_code: &'a Script,
    },
    SegwitV0 {
        script_code: &'a Script,
    },
    KeyPath {
        annex: Option<&'a [u8]>,
    },
    Tapscript {
        annex: Option<&'a [u8]>,
        tapleaf_hash: TapLeafHash,
        code_separator: u32,
    },
}

pub struct UnifiedSighash<'a> {
    transaction: &'a Transaction,
    spent_outputs: &'a [TxOut],
    prevouts: [u8; 32],
    amounts: [u8; 32],
    scripts: [u8; 32],
    sequences: [u8; 32],
    outputs: [u8; 32],
}

fn hash_parts(parts: impl Iterator<Item = Vec<u8>>) -> [u8; 32] {
    let mut engine = sha256::Hash::engine();
    for part in parts {
        engine.input(&part);
    }
    sha256::Hash::from_engine(engine).to_byte_array()
}

fn tagged_hash(message: &[u8]) -> [u8; 32] {
    let tag = sha256::Hash::hash(b"UnifiedSighash");
    let mut engine = sha256::Hash::engine();
    engine.input(tag.as_byte_array());
    engine.input(tag.as_byte_array());
    engine.input(message);
    sha256::Hash::from_engine(engine).to_byte_array()
}

impl<'a> UnifiedSighash<'a> {
    pub fn new(transaction: &'a Transaction, spent_outputs: &'a [TxOut]) -> Result<Self> {
        if transaction.input.is_empty()
            || transaction.input.len() != spent_outputs.len()
            || transaction.input.len() > u32::MAX as usize
        {
            return Err(Error::Transaction);
        }
        Ok(Self {
            transaction,
            spent_outputs,
            prevouts: hash_parts(
                transaction
                    .input
                    .iter()
                    .map(|input| serialize(&input.previous_output)),
            ),
            amounts: hash_parts(
                spent_outputs
                    .iter()
                    .map(|output| output.value.to_sat().to_le_bytes().to_vec()),
            ),
            scripts: hash_parts(
                spent_outputs
                    .iter()
                    .map(|output| serialize(&output.script_pubkey)),
            ),
            sequences: hash_parts(
                transaction
                    .input
                    .iter()
                    .map(|input| serialize(&input.sequence)),
            ),
            outputs: hash_parts(transaction.output.iter().map(serialize)),
        })
    }

    pub fn digest(&self, input: usize, context: SpendContext<'_>) -> Result<[u8; 32]> {
        self.digest_with_type(input, DEFAULT_HASH_TYPE, context)
    }

    pub fn digest_with_type(
        &self,
        input: usize,
        hash_type: u8,
        context: SpendContext<'_>,
    ) -> Result<[u8; 32]> {
        Ok(tagged_hash(&self.preimage(input, hash_type, context)?))
    }

    pub fn preimage(
        &self,
        input: usize,
        hash_type: u8,
        context: SpendContext<'_>,
    ) -> Result<Vec<u8>> {
        let txin = self
            .transaction
            .input
            .get(input)
            .ok_or(Error::Transaction)?;
        if hash_type & 0x20 == 0 {
            return Err(Error::Transaction);
        }
        let output_type = hash_type & 0x1f;
        let anyone_can_pay = hash_type & 0x80 != 0;
        let script_type = match context {
            SpendContext::Legacy { .. } => 0,
            SpendContext::SegwitV0 { .. } => 1,
            SpendContext::KeyPath { .. } => 2,
            SpendContext::Tapscript { .. } => 3,
        };
        if script_type >= 2 && (hash_type & 0x40 != 0 || !(1..=3).contains(&output_type)) {
            return Err(Error::Transaction);
        }
        let mut message = vec![0, hash_type];
        message.extend(serialize(&self.transaction.version));
        message.extend(self.transaction.lock_time.to_consensus_u32().to_le_bytes());
        message.push(0);
        if !anyone_can_pay {
            message.extend(self.prevouts);
            message.extend(self.amounts);
            message.extend(self.scripts);
            message.extend(self.sequences);
        }
        if output_type != 2 && output_type != 3 {
            message.extend(self.outputs);
        }
        message.push(script_type);
        if anyone_can_pay {
            message.extend(serialize(&txin.previous_output));
            message.extend(serialize(&self.spent_outputs[input]));
            message.extend(serialize(&txin.sequence));
        } else {
            message.extend((input as u32).to_le_bytes());
        }
        match context {
            SpendContext::Legacy { script_code } | SpendContext::SegwitV0 { script_code } => {
                message.extend(serialize(&script_code.to_owned()));
            }
            SpendContext::KeyPath { annex } | SpendContext::Tapscript { annex, .. } => {
                message.push(u8::from(annex.is_some()));
                if let Some(annex) = annex {
                    if annex.first() != Some(&0x50) {
                        return Err(Error::Transaction);
                    }
                    message.extend(sha256::Hash::hash(&serialize(&annex.to_vec())).to_byte_array());
                }
            }
        }
        if output_type == 3 {
            let output = self
                .transaction
                .output
                .get(input)
                .ok_or(Error::Transaction)?;
            message.extend(sha256::Hash::hash(&serialize(output)).to_byte_array());
        }
        if let SpendContext::Tapscript {
            tapleaf_hash,
            code_separator,
            ..
        } = context
        {
            message.extend(tapleaf_hash.to_byte_array());
            message.push(0);
            message.extend(code_separator.to_le_bytes());
        }
        Ok(message)
    }
}

pub fn encode_unified_signature(signature: [u8; 64]) -> [u8; 65] {
    let mut witness = [0; 65];
    witness[..64].copy_from_slice(&signature);
    witness[64] = DEFAULT_HASH_TYPE;
    witness
}
