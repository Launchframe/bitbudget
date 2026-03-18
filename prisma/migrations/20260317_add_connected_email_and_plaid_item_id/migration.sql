-- CreateTable
CREATE TABLE "ConnectedEmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "email" TEXT NOT NULL,
    "lastScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedEmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectedEmailAccount_userId_idx" ON "ConnectedEmailAccount"("userId");

-- AddForeignKey
ALTER TABLE "ConnectedEmailAccount" ADD CONSTRAINT "ConnectedEmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add plaidItemId to PlaidItem (if PlaidItem table exists from prior db push)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PlaidItem') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PlaidItem' AND column_name = 'plaidItemId') THEN
            ALTER TABLE "PlaidItem" ADD COLUMN "plaidItemId" TEXT;
            UPDATE "PlaidItem" SET "plaidItemId" = 'legacy-' || "id" WHERE "plaidItemId" IS NULL;
            ALTER TABLE "PlaidItem" ALTER COLUMN "plaidItemId" SET NOT NULL;
            CREATE UNIQUE INDEX "PlaidItem_plaidItemId_key" ON "PlaidItem"("plaidItemId");
        END IF;
    END IF;
END $$;
