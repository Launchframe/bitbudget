-- Communication preferences default to enabled for new and existing accounts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "emailFeatureUpdates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailFeedbackRequests" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailRecurringReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailRenewalReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailImportAlerts" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailUnsubscribeToken" TEXT;

UPDATE "User"
SET "emailUnsubscribeToken" = gen_random_uuid()::text
WHERE "emailUnsubscribeToken" IS NULL;

ALTER TABLE "User"
  ALTER COLUMN "emailUnsubscribeToken" SET DEFAULT gen_random_uuid()::text;

ALTER TABLE "User"
  ALTER COLUMN "emailUnsubscribeToken" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_emailUnsubscribeToken_key" ON "User"("emailUnsubscribeToken");
