-- Savings as core mechanic: pay cadence fields, goals, achievements, sweeps; ledger always on.

-- User: new pay/savings fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "payDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "payDayOfWeek" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPaydayAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "estimatedAnnualIncome" DECIMAL(12, 2);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sweepDefaultPolicy" TEXT NOT NULL DEFAULT 'reset';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sweepDefaultCapMultiplier" DECIMAL(4, 2);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "savingsExperience" TEXT NOT NULL DEFAULT 'engaged';

-- User: ledger funding toggle removed (always on)
ALTER TABLE "User" DROP COLUMN IF EXISTS "ledgerFundingEnabled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "fundingStartedAt";

-- Envelope: per-envelope sweep policy
ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "sweepPolicy" TEXT NOT NULL DEFAULT 'reset';
ALTER TABLE "Envelope" ADD COLUMN IF NOT EXISTS "sweepCapMultiplier" DECIMAL(4, 2);

-- EnvelopeFundingBatch: fund vs sweep batches
ALTER TABLE "EnvelopeFundingBatch" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'fund';

DROP INDEX IF EXISTS "EnvelopeFundingBatch_userId_periodKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EnvelopeFundingBatch_userId_periodKey_kind_key"
  ON "EnvelopeFundingBatch"("userId", "periodKey", "kind");

-- SavingsGoal
CREATE TABLE IF NOT EXISTS "SavingsGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "targetAmount" DECIMAL(12, 2) NOT NULL,
    "graceEndsAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "startBalance" DECIMAL(12, 2),
    "endBalance" DECIMAL(12, 2),
    "actualSavedAmount" DECIMAL(12, 2),
    "netSavingsInflow" DECIMAL(12, 2),
    "achievedGoal" BOOLEAN,
    "progressPct" DECIMAL(8, 4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavingsGoal_userId_periodKey_key" ON "SavingsGoal"("userId", "periodKey");
CREATE INDEX IF NOT EXISTS "SavingsGoal_userId_closedAt_idx" ON "SavingsGoal"("userId", "closedAt");

DO $$
BEGIN
  ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- UserAchievement
CREATE TABLE IF NOT EXISTS "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserAchievement_userId_code_key" ON "UserAchievement"("userId", "code");
CREATE INDEX IF NOT EXISTS "UserAchievement_userId_earnedAt_idx" ON "UserAchievement"("userId", "earnedAt");

DO $$
BEGIN
  ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "SavingsGoal" ALTER COLUMN "updatedAt" DROP DEFAULT;
