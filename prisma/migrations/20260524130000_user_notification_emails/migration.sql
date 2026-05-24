-- Multiple verified notification emails per user; migrate legacy single-column data.

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

INSERT INTO "UserNotificationEmail" ("id", "userId", "email", "verifiedAt", "createdAt")
SELECT
  'mig_' || "id",
  "id",
  "notificationEmail",
  "notificationEmailVerified",
  COALESCE("notificationEmailVerified", CURRENT_TIMESTAMP)
FROM "User"
WHERE "notificationEmail" IS NOT NULL
  AND "notificationEmailVerified" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "UserNotificationEmail" u
    WHERE u."userId" = "User"."id" AND u."email" = "User"."notificationEmail"
  );

ALTER TABLE "User" DROP COLUMN IF EXISTS "notificationEmail";
ALTER TABLE "User" DROP COLUMN IF EXISTS "notificationEmailVerified";

ALTER TABLE "UserNotificationEmail"
  ADD CONSTRAINT "UserNotificationEmail_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
