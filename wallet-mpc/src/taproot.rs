use bitcoin::{
    Transaction, TxOut, Witness,
    hashes::Hash,
    sighash::{Prevouts, SighashCache, TapSighashType},
};

use crate::{Error, Result};

fn hash_type(value: u8) -> Result<TapSighashType> {
    match value {
        0 => Ok(TapSighashType::Default),
        1 => Ok(TapSighashType::All),
        _ => Err(Error::Transaction),
    }
}

pub fn keypath_digest(
    transaction: &Transaction,
    spent_outputs: &[TxOut],
    input: usize,
    sighash_type: u8,
) -> Result<[u8; 32]> {
    if input >= transaction.input.len() || transaction.input.len() != spent_outputs.len() {
        return Err(Error::Transaction);
    }
    SighashCache::new(transaction)
        .taproot_key_spend_signature_hash(
            input,
            &Prevouts::All(spent_outputs),
            hash_type(sighash_type)?,
        )
        .map(|hash| hash.to_byte_array())
        .map_err(|_| Error::Transaction)
}

pub fn finalize_keypath(
    mut transaction: Transaction,
    input: usize,
    signature: &[u8; 64],
    sighash_type: u8,
) -> Result<Transaction> {
    hash_type(sighash_type)?;
    let input = transaction.input.get_mut(input).ok_or(Error::Transaction)?;
    if !input.script_sig.is_empty() || !input.witness.is_empty() {
        return Err(Error::Transaction);
    }
    let mut signature = signature.to_vec();
    if sighash_type != 0 {
        signature.push(sighash_type);
    }
    input.witness = Witness::from_slice(&[signature]);
    Ok(transaction)
}
