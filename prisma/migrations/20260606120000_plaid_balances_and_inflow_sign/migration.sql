-- Plaid account balances, and pending-transaction sign (inflows are credits).

ALTER TABLE "PendingTransaction" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'expense';

ALTER TABLE "PlaidAccount" ADD COLUMN IF NOT EXISTS "plaidAccountId" TEXT;
ALTER TABLE "PlaidAccount" ADD COLUMN IF NOT EXISTS "currentBalance" DECIMAL(14,2);
ALTER TABLE "PlaidAccount" ADD COLUMN IF NOT EXISTS "availableBalance" DECIMAL(14,2);
ALTER TABLE "PlaidAccount" ADD COLUMN IF NOT EXISTS "isoCurrencyCode" TEXT;
ALTER TABLE "PlaidAccount" ADD COLUMN IF NOT EXISTS "balanceUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "PlaidAccount_plaidAccountId_key" ON "PlaidAccount"("plaidAccountId");
