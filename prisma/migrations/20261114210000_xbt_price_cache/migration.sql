-- Daily XBT (Bitcoin Blake2B) USD price cache, parallel to BtcPriceCache.
CREATE TABLE IF NOT EXISTS "XbtPriceCache" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XbtPriceCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "XbtPriceCache_date_key" ON "XbtPriceCache"("date");
