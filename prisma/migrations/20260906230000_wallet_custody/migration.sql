BEGIN;

CREATE TABLE IF NOT EXISTS "WalletAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "outputKey" BYTEA,
    "publicPackage" BYTEA,
    "recoveryVerifiedAt" TIMESTAMP(3),
    "recoveryFileHash" TEXT,
    "derivationContext" TEXT NOT NULL DEFAULT 'base-output-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "userHandle" TEXT NOT NULL,
    "rpId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "operation" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "lineage" TEXT,
    "profileId" TEXT NOT NULL,
    "digest" TEXT,
    "challenge" TEXT NOT NULL,
    "payloadHash" TEXT,
    "userHandle" TEXT,
    "origin" TEXT NOT NULL,
    "rpId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "credentialId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "lineage" TEXT,
    "profileId" TEXT NOT NULL,
    "digest" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletCosigner" (
    "walletId" TEXT NOT NULL,
    "encryptedShare" BYTEA NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletCosigner_pkey" PRIMARY KEY ("walletId")
);

CREATE TABLE IF NOT EXISTS "WalletProvisioning" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "transcriptHash" TEXT NOT NULL,
    "encryptedState" BYTEA,
    "encryptedResponse" BYTEA NOT NULL,
    "completionHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'round2',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletProvisioning_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletNonceUse" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "lineage" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "commitmentHash" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletNonceUse_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WalletAccount" ADD COLUMN IF NOT EXISTS "recoveryVerifiedAt" TIMESTAMP(3);
ALTER TABLE "WalletAccount" ADD COLUMN IF NOT EXISTS "recoveryFileHash" TEXT;
ALTER TABLE "WalletAccount" ADD COLUMN IF NOT EXISTS "derivationContext" TEXT NOT NULL DEFAULT 'base-output-v1';
ALTER TABLE "WalletChallenge" ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;
ALTER TABLE "WalletCredential" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "WalletAccount_userId_createdAt_idx" ON "WalletAccount"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletCredential_credentialId_key" ON "WalletCredential"("credentialId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletCredential_userId_rpId_key" ON "WalletCredential"("userId", "rpId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletChallenge_challenge_key" ON "WalletChallenge"("challenge");
CREATE INDEX IF NOT EXISTS "WalletChallenge_userId_operation_expiresAt_idx" ON "WalletChallenge"("userId", "operation", "expiresAt");
CREATE INDEX IF NOT EXISTS "WalletChallenge_expiresAt_idx" ON "WalletChallenge"("expiresAt");
CREATE INDEX IF NOT EXISTS "WalletGrant_userId_walletId_operation_expiresAt_idx" ON "WalletGrant"("userId", "walletId", "operation", "expiresAt");
CREATE INDEX IF NOT EXISTS "WalletGrant_expiresAt_idx" ON "WalletGrant"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletProvisioning_walletId_key" ON "WalletProvisioning"("walletId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletProvisioning_grantId_key" ON "WalletProvisioning"("grantId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletNonceUse_grantId_key" ON "WalletNonceUse"("grantId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletNonceUse_commitmentHash_key" ON "WalletNonceUse"("commitmentHash");
CREATE INDEX IF NOT EXISTS "WalletNonceUse_userId_walletId_idx" ON "WalletNonceUse"("userId", "walletId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WalletCosigner_walletId_fkey' AND conrelid = '"WalletCosigner"'::regclass) THEN
        ALTER TABLE "WalletCosigner" ADD CONSTRAINT "WalletCosigner_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WalletProvisioning_walletId_fkey' AND conrelid = '"WalletProvisioning"'::regclass) THEN
        ALTER TABLE "WalletProvisioning" ADD CONSTRAINT "WalletProvisioning_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
