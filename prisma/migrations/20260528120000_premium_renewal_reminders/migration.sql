-- Premium renewal reminders: membership expiry + dedup log
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "premiumMembershipUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PremiumRenewalReminderLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "logKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PremiumRenewalReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PremiumRenewalReminderLog_userId_logKey_channel_key"
  ON "PremiumRenewalReminderLog"("userId", "logKey", "channel");

CREATE INDEX IF NOT EXISTS "PremiumRenewalReminderLog_userId_idx"
  ON "PremiumRenewalReminderLog"("userId");

DO $$ BEGIN
  ALTER TABLE "PremiumRenewalReminderLog"
    ADD CONSTRAINT "PremiumRenewalReminderLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
