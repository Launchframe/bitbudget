-- AlterTable (idempotent: column may already exist from a partial apply or manual change)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Composite index for GET /api/transactions?since= (userId + updatedAt filter)
CREATE INDEX IF NOT EXISTS "Transaction_userId_updatedAt_idx" ON "Transaction"("userId", "updatedAt");
