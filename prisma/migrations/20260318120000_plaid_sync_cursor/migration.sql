-- AlterTable
ALTER TABLE "PlaidItem" ADD COLUMN "transactionsSyncCursor" TEXT;

-- CreateTable
CREATE TABLE "PlaidImportedTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plaidTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaidImportedTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaidImportedTransaction_plaidTransactionId_key" ON "PlaidImportedTransaction"("plaidTransactionId");

CREATE INDEX "PlaidImportedTransaction_userId_idx" ON "PlaidImportedTransaction"("userId");

ALTER TABLE "PlaidImportedTransaction" ADD CONSTRAINT "PlaidImportedTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
