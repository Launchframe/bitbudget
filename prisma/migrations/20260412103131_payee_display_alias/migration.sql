-- PayeeDisplayAlias: user mappings from imported/OCR descriptors to preferred payee names.

CREATE TABLE "PayeeDisplayAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceNormalized" TEXT NOT NULL,
    "canonicalPayee" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayeeDisplayAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayeeDisplayAlias_userId_sourceNormalized_key" ON "PayeeDisplayAlias"("userId", "sourceNormalized");

CREATE INDEX "PayeeDisplayAlias_userId_updatedAt_idx" ON "PayeeDisplayAlias"("userId", "updatedAt");

ALTER TABLE "PayeeDisplayAlias" ADD CONSTRAINT "PayeeDisplayAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
