-- Per-user post-onboarding dashboard walkthrough (replaces browser-localStorage flag).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walkthroughCompleted" BOOLEAN NOT NULL DEFAULT false;
