-- Pending statement batches (email attachment review) + funding batch config metadata.
-- Idempotent: safe if objects already exist from local WIP migrations.

ALTER TABLE "EnvelopeFundingBatch" ADD COLUMN IF NOT EXISTS "config" JSONB;

DROP INDEX IF EXISTS "Envelope_userId_deletedAt_idx";

CREATE TABLE IF NOT EXISTS "PendingStatementBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "institutionName" TEXT,
    "format" TEXT NOT NULL,
    "transactions" JSONB NOT NULL,
    "dateFrom" TEXT,
    "dateTo" TEXT,
    "transactionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingStatementBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PendingStatementBatch_userId_idx" ON "PendingStatementBatch"("userId");
CREATE INDEX IF NOT EXISTS "PendingStatementBatch_userId_createdAt_idx" ON "PendingStatementBatch"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "PendingStatementBatch" ADD CONSTRAINT "PendingStatementBatch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
