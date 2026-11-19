-- CreateTable
CREATE TABLE IF NOT EXISTS "PendingBtcSale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sats" BIGINT NOT NULL,
    "markPriceUsd" DECIMAL(12,2) NOT NULL,
    "proceedsUsd" DECIMAL(12,2),
    "linkedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingBtcSale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PendingBtcSale_userId_idx" ON "PendingBtcSale"("userId");

DO $$ BEGIN
  ALTER TABLE "PendingBtcSale" ADD CONSTRAINT "PendingBtcSale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
