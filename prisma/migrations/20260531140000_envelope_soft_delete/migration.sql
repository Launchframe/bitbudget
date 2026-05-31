-- Soft-delete envelopes: deletedAt + purge after grace window (see lib/envelope-delete.ts)
ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Envelope_userId_deletedAt_idx" ON "Envelope"("userId", "deletedAt");
