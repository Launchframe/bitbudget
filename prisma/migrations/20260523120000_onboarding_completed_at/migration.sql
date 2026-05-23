-- When onboarding finishes; used for post-onboarding referral redeem window.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

UPDATE "User"
SET "onboardingCompletedAt" = "updatedAt"
WHERE "onboardingComplete" = true
  AND "onboardingCompletedAt" IS NULL;
