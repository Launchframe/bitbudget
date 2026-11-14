-- CreateTable
CREATE TABLE IF NOT EXISTS "BtcLoan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "principalUsd" DECIMAL(12,2) NOT NULL,
    "apr" DECIMAL(6,4) NOT NULL,
    "openedOn" TEXT NOT NULL,
    "maturityOn" TEXT NOT NULL,
    "collateralSats" BIGINT NOT NULL,
    "lenderSellPriceUsd" DECIMAL(12,2) NOT NULL,
    "payoffStyle" TEXT NOT NULL,
    "maturityBillOverrideUsd" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BtcLoan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BtcLoan_userId_idx" ON "BtcLoan"("userId");

DO $$ BEGIN
  ALTER TABLE "BtcLoan" ADD CONSTRAINT "BtcLoan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
