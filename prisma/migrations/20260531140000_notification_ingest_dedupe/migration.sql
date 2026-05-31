-- Idempotency keys for Android notification-forward webhook (idempotent).
CREATE TABLE IF NOT EXISTS "NotificationIngestDedupe" (
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationIngestDedupe_pkey" PRIMARY KEY ("userId","idempotencyKey")
);

CREATE INDEX IF NOT EXISTS "NotificationIngestDedupe_createdAt_idx"
  ON "NotificationIngestDedupe"("createdAt");

DO $$ BEGIN
  ALTER TABLE "NotificationIngestDedupe" ADD CONSTRAINT "NotificationIngestDedupe_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
