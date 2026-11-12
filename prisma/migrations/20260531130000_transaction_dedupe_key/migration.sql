-- Idempotent: add dedupeKey column for CSV import idempotency.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

-- Partial unique index powers createMany({ skipDuplicates: true }) for imports.
-- Rows with a NULL dedupeKey (manual entry, voice, plaid, etc.) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_userId_dedupeKey_key"
  ON "Transaction" ("userId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
