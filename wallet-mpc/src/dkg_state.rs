use super::{DkgRound1, DkgRound2, Error, Participant, Result, frost, peers, unique};
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"BitBudget-DKG\x01";
const MAX_STATE_BYTES: usize = 16_384;

fn prefix(round: u8, participant: Participant) -> Zeroizing<Vec<u8>> {
    let mut bytes = Zeroizing::new(MAGIC.to_vec());
    bytes.extend_from_slice(&[round, participant as u8]);
    bytes
}

fn push(bytes: &mut Vec<u8>, part: &[u8]) -> Result<()> {
    if part.is_empty() || bytes.len() + 4 + part.len() > MAX_STATE_BYTES {
        return Err(Error::Transcript);
    }
    bytes.extend_from_slice(&(part.len() as u32).to_le_bytes());
    bytes.extend_from_slice(part);
    Ok(())
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn open(bytes: &'a [u8], round: u8, participant: Participant) -> Result<Self> {
        if bytes.len() > MAX_STATE_BYTES || !bytes.starts_with(&prefix(round, participant)) {
            return Err(Error::Transcript);
        }
        Ok(Self(&bytes[MAGIC.len() + 2..]))
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        if self.0.len() < length {
            return Err(Error::Transcript);
        }
        let (part, rest) = self.0.split_at(length);
        self.0 = rest;
        Ok(part)
    }

    fn part(&mut self) -> Result<&'a [u8]> {
        let length =
            u32::from_le_bytes(self.take(4)?.try_into().map_err(|_| Error::Transcript)?) as usize;
        if length == 0 || length > MAX_STATE_BYTES {
            return Err(Error::Transcript);
        }
        self.take(length)
    }

    fn finish(self) -> Result<()> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(Error::Transcript)
        }
    }
}

impl DkgRound1 {
    pub fn export_secret_state(self) -> Result<Zeroizing<Vec<u8>>> {
        let mut bytes = prefix(1, self.participant);
        let secret = Zeroizing::new(self.secret.serialize()?);
        push(&mut bytes, &secret)?;
        push(&mut bytes, &self.broadcast.serialize()?)?;
        Ok(bytes)
    }

    pub fn restore_secret_state(participant: Participant, bytes: &[u8]) -> Result<Self> {
        let mut reader = Reader::open(bytes, 1, participant)?;
        let secret = frost::keys::dkg::round1::SecretPackage::deserialize(reader.part()?)?;
        let broadcast = frost::keys::dkg::round1::Package::deserialize(reader.part()?)?;
        reader.finish()?;
        if secret.identifier() != &participant.id()
            || *secret.min_signers() != 2
            || *secret.max_signers() != 3
            || secret.commitment() != broadcast.commitment()
        {
            return Err(Error::Transcript);
        }
        Ok(Self {
            participant,
            secret,
            broadcast,
        })
    }
}

impl DkgRound2 {
    pub fn export_secret_state(self) -> Result<Zeroizing<Vec<u8>>> {
        let mut bytes = prefix(2, self.participant);
        let secret = Zeroizing::new(self.secret.serialize()?);
        push(&mut bytes, &secret)?;
        for id in [Participant::A, Participant::B, Participant::C] {
            if id != self.participant {
                bytes.push(id as u8);
                push(
                    &mut bytes,
                    &self
                        .transcript
                        .get(&id.id())
                        .ok_or(Error::Transcript)?
                        .serialize()?,
                )?;
            }
        }
        push(&mut bytes, &self.broadcast_digest)?;
        Ok(bytes)
    }

    pub fn restore_secret_state(participant: Participant, bytes: &[u8]) -> Result<Self> {
        let mut reader = Reader::open(bytes, 2, participant)?;
        let secret = frost::keys::dkg::round2::SecretPackage::deserialize(reader.part()?)?;
        let mut packages = Vec::new();
        for _ in 0..2 {
            let id = Participant::try_from(reader.take(1)?[0] as u16)?;
            let package = frost::keys::dkg::round1::Package::deserialize(reader.part()?)?;
            packages.push((id, package));
        }
        let transcript = unique(packages)?;
        let broadcast_digest = reader.part()?.try_into().map_err(|_| Error::Transcript)?;
        reader.finish()?;
        peers(participant, &transcript)?;
        if secret.identifier() != &participant.id()
            || *secret.min_signers() != 2
            || *secret.max_signers() != 3
        {
            return Err(Error::Transcript);
        }
        Ok(Self {
            participant,
            secret,
            transcript,
            broadcast_digest,
        })
    }
}
