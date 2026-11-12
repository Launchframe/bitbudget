-- Reject plaintext journal notes at rest. The API validator uses the same
-- rule (`looksLikeAsymmetricCiphertext`): standard base64, length a multiple
-- of 4, between a minimal sealed box (96 chars = 72 bytes) and 64_000 chars.
-- Idempotent: adding the constraint again is a no-op.
DO $$ BEGIN
  ALTER TABLE "RunwayJournalEntry"
    ADD CONSTRAINT "RunwayJournalEntry_encryptedBody_sealed" CHECK (
      char_length("encryptedBody") >= 96
      AND char_length("encryptedBody") <= 64000
      AND char_length("encryptedBody") % 4 = 0
      AND "encryptedBody" ~ '^[A-Za-z0-9+/]*={0,2}$'
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
