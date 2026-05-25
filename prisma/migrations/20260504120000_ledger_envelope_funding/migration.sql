-- Ledger-style envelope funding: system Savings envelope, funding batches, hidden allocation legs.

ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "systemRole" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ledgerFundingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fundingStartedAt" TIMESTAMP(3);

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "excludeFromMainHistory" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "fundingBatchId" TEXT;

CREATE TABLE IF NOT EXISTS "EnvelopeFundingBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvelopeFundingBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EnvelopeFundingBatch_userId_periodKey_key" ON "EnvelopeFundingBatch"("userId", "periodKey");

CREATE INDEX IF NOT EXISTS "EnvelopeFundingBatch_userId_idx" ON "EnvelopeFundingBatch"("userId");

CREATE INDEX IF NOT EXISTS "Transaction_fundingBatchId_idx" ON "Transaction"("fundingBatchId");

DO $$
BEGIN
  ALTER TABLE "EnvelopeFundingBatch" ADD CONSTRAINT "EnvelopeFundingBatch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fundingBatchId_fkey"
    FOREIGN KEY ("fundingBatchId") REFERENCES "EnvelopeFundingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Do not bulk-assign systemRole here: enabling ledger funding promotes/creates Savings via ensureSystemSavingsEnvelope().
