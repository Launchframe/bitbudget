-- Notification contact channels for Nostr users (email without login, optional Nostr DMs).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "notificationEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "notificationEmailVerified" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nostrDmEnabled" BOOLEAN NOT NULL DEFAULT false;
