-- Multiple verified notification emails per user.

CREATE TABLE IF NOT EXISTS "UserNotificationEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserNotificationEmail_userId_email_key"
  ON "UserNotificationEmail"("userId", "email");
CREATE INDEX IF NOT EXISTS "UserNotificationEmail_userId_idx" ON "UserNotificationEmail"("userId");

ALTER TABLE "UserNotificationEmail"
  ADD CONSTRAINT "UserNotificationEmail_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
