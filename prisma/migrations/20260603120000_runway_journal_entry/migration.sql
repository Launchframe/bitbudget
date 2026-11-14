-- Encrypted, month-scoped Financial Runway journal entries (idempotent).
-- The server only ever stores ciphertext in "encryptedBody"; it is never
-- logged or decrypted on the backend.
CREATE TABLE IF NOT EXISTS "RunwayJournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "envelopeId" TEXT,
    "encryptedBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunwayJournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RunwayJournalEntry_userId_monthKey_idx" ON "RunwayJournalEntry"("userId", "monthKey");

CREATE INDEX IF NOT EXISTS "RunwayJournalEntry_envelopeId_idx" ON "RunwayJournalEntry"("envelopeId");

DO $$ BEGIN
  ALTER TABLE "RunwayJournalEntry" ADD CONSTRAINT "RunwayJournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "RunwayJournalEntry" ADD CONSTRAINT "RunwayJournalEntry_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
