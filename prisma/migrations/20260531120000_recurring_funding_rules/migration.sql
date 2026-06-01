-- CreateTable
CREATE TABLE IF NOT EXISTS "RecurringFundingRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "distributionConfig" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringFundingRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecurringFundingRule_userId_nextRunAt_idx" ON "RecurringFundingRule"("userId", "nextRunAt");

DO $$ BEGIN
  ALTER TABLE "RecurringFundingRule" ADD CONSTRAINT "RecurringFundingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
