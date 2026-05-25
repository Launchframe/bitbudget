-- Nostr DM opt-in for product notifications (verified emails use UserNotificationEmail).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "nostrDmEnabled" BOOLEAN NOT NULL DEFAULT false;
