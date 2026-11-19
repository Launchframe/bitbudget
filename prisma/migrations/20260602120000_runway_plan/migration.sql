-- Financial Runway plan, 1:1 with User (idempotent).
CREATE TABLE IF NOT EXISTS "RunwayPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'buildup',
    "quitDate" TEXT,
    "horizonMonths" INTEGER NOT NULL DEFAULT 24,
    "runwayIncomeUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "livingBaselineOverrideUsd" DECIMAL(12,2),
    "inflationRateYear" DECIMAL(8,4) NOT NULL DEFAULT 0.05,
    "stressPercent" DECIMAL(8,4) NOT NULL DEFAULT 0.50,
    "growthRateYear" DECIMAL(8,4),
    "dipResponse" TEXT NOT NULL DEFAULT 'cut',
    "btcSharePreference" TEXT NOT NULL DEFAULT 'half',
    "borrowStance" TEXT NOT NULL DEFAULT 'deep_drop',
    "editedCashFloorUsd" DECIMAL(12,2),
    "editedBorrowCapFraction" DECIMAL(8,4),
    "cashOverrideUsd" DECIMAL(12,2),
    "bitcoinOverrideSats" BIGINT,
    "plannedLines" JSONB NOT NULL DEFAULT '[]',
    "scenarios" JSONB NOT NULL DEFAULT '[]',
    "envelopePriorities" JSONB NOT NULL DEFAULT '{}',
    "checkupOpenedMonthKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunwayPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RunwayPlan_userId_key" ON "RunwayPlan"("userId");

DO $$ BEGIN
  ALTER TABLE "RunwayPlan" ADD CONSTRAINT "RunwayPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
