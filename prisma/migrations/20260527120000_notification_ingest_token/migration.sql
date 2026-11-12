-- Per-user token for Android notification-forward webhook (idempotent).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notificationIngestToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_notificationIngestToken_key"
  ON "User"("notificationIngestToken");
