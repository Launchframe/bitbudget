-- Communication preferences default to enabled for new and existing accounts.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "emailFeatureUpdates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailFeedbackRequests" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailRecurringReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailRenewalReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailImportAlerts" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailUnsubscribeToken" TEXT;

UPDATE "User"
SET "emailUnsubscribeToken" = COALESCE("emailUnsubscribeToken", md5(random()::text || clock_timestamp()::text || id))
WHERE "emailUnsubscribeToken" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_emailUnsubscribeToken_key" ON "User"("emailUnsubscribeToken");
