-- Track failed OTP verify attempts to throttle brute-force on notification-email linking.

ALTER TABLE "EmailCode"
  ADD COLUMN IF NOT EXISTS "failedAttempts" INTEGER NOT NULL DEFAULT 0;
