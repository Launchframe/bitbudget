-- When onboarding finishes; used for post-onboarding referral redeem window.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- Intentionally no backfill: updatedAt changes on unrelated profile writes and would
-- incorrectly reopen the 7-day redeem window. Set onboardingCompletedAt only when
-- onboardingComplete first flips to true (PUT /api/user/settings).
