-- Opportunity Cost reference ticker: "btc" | "xbt" (default BTC).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referenceAsset" TEXT NOT NULL DEFAULT 'btc';
