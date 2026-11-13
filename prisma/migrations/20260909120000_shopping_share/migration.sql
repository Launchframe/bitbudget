-- Encrypted shared shopping groups, lists, receipts, tab events, and private postings.

CREATE TABLE IF NOT EXISTS "ShoppingGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "encryptedMetadata" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "membershipRevision" INTEGER NOT NULL DEFAULT 1,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "lifecycle" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "localId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "encryptedAlias" TEXT NOT NULL,
    "pinnedKeyFingerprint" TEXT NOT NULL,
    "historyAccess" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingMemberKey" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingMemberKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingInvite" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimantUserId" TEXT,
    "claimantPublicKey" TEXT,
    "claimantKeyFingerprint" TEXT,
    "encryptedClaimantAlias" TEXT,
    "verificationCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingList" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingRequest" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "requesterMemberId" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingReceipt" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "listId" TEXT,
    "payerMemberId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "frozenRequestSnapshot" TEXT,
    "finalizedEventId" TEXT,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorMemberId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "affectedMemberIds" TEXT NOT NULL DEFAULT '[]',
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingBudgetPreference" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAtSequence" INTEGER,
    "catchUpApproved" BOOLEAN NOT NULL DEFAULT false,
    "envelopeId" TEXT,
    "preferenceVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingBudgetPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShoppingPosting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "projectionRevision" INTEGER NOT NULL,
    "entryKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'needs_attention',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingPosting_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "shoppingPostingId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingMember_groupId_localId_key" ON "ShoppingMember"("groupId", "localId");
CREATE INDEX IF NOT EXISTS "ShoppingMember_groupId_status_idx" ON "ShoppingMember"("groupId", "status");
CREATE INDEX IF NOT EXISTS "ShoppingMember_userId_idx" ON "ShoppingMember"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingMember_groupId_userId_active_key"
  ON "ShoppingMember"("groupId", "userId")
  WHERE "userId" IS NOT NULL AND "status" = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingMemberKey_memberId_keyVersion_key" ON "ShoppingMemberKey"("memberId", "keyVersion");
CREATE INDEX IF NOT EXISTS "ShoppingMemberKey_groupId_keyVersion_idx" ON "ShoppingMemberKey"("groupId", "keyVersion");

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingInvite_tokenHash_key" ON "ShoppingInvite"("tokenHash");
CREATE INDEX IF NOT EXISTS "ShoppingInvite_groupId_status_idx" ON "ShoppingInvite"("groupId", "status");
CREATE INDEX IF NOT EXISTS "ShoppingInvite_claimantUserId_idx" ON "ShoppingInvite"("claimantUserId");
CREATE INDEX IF NOT EXISTS "ShoppingInvite_expiresAt_idx" ON "ShoppingInvite"("expiresAt");

CREATE INDEX IF NOT EXISTS "ShoppingList_groupId_tombstone_idx" ON "ShoppingList"("groupId", "tombstone");
CREATE INDEX IF NOT EXISTS "ShoppingRequest_groupId_listId_idx" ON "ShoppingRequest"("groupId", "listId");
CREATE INDEX IF NOT EXISTS "ShoppingRequest_listId_tombstone_idx" ON "ShoppingRequest"("listId", "tombstone");

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingReceipt_finalizedEventId_key" ON "ShoppingReceipt"("finalizedEventId");
CREATE INDEX IF NOT EXISTS "ShoppingReceipt_groupId_status_idx" ON "ShoppingReceipt"("groupId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingEvent_groupId_sequence_key" ON "ShoppingEvent"("groupId", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingEvent_groupId_operationId_key" ON "ShoppingEvent"("groupId", "operationId");
CREATE INDEX IF NOT EXISTS "ShoppingEvent_groupId_createdAt_idx" ON "ShoppingEvent"("groupId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingBudgetPreference_groupId_userId_key" ON "ShoppingBudgetPreference"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "ShoppingBudgetPreference_userId_idx" ON "ShoppingBudgetPreference"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingPosting_userId_eventId_entryKey_key" ON "ShoppingPosting"("userId", "eventId", "entryKey");
CREATE INDEX IF NOT EXISTS "ShoppingPosting_userId_status_idx" ON "ShoppingPosting"("userId", "status");
CREATE INDEX IF NOT EXISTS "ShoppingPosting_groupId_eventId_idx" ON "ShoppingPosting"("groupId", "eventId");

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_shoppingPostingId_key" ON "Transaction"("shoppingPostingId");
CREATE INDEX IF NOT EXISTS "ShoppingGroup_ownerId_idx" ON "ShoppingGroup"("ownerId");
CREATE INDEX IF NOT EXISTS "ShoppingGroup_lifecycle_idx" ON "ShoppingGroup"("lifecycle");

DO $$ BEGIN
  ALTER TABLE "ShoppingGroup" ADD CONSTRAINT "ShoppingGroup_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingMember" ADD CONSTRAINT "ShoppingMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingMember" ADD CONSTRAINT "ShoppingMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingMemberKey" ADD CONSTRAINT "ShoppingMemberKey_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingMemberKey" ADD CONSTRAINT "ShoppingMemberKey_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "ShoppingMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingInvite" ADD CONSTRAINT "ShoppingInvite_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingInvite" ADD CONSTRAINT "ShoppingInvite_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingRequest" ADD CONSTRAINT "ShoppingRequest_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingRequest" ADD CONSTRAINT "ShoppingRequest_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingReceipt" ADD CONSTRAINT "ShoppingReceipt_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingReceipt" ADD CONSTRAINT "ShoppingReceipt_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "ShoppingList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingEvent" ADD CONSTRAINT "ShoppingEvent_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingBudgetPreference" ADD CONSTRAINT "ShoppingBudgetPreference_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingBudgetPreference" ADD CONSTRAINT "ShoppingBudgetPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingBudgetPreference" ADD CONSTRAINT "ShoppingBudgetPreference_envelopeId_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingPosting" ADD CONSTRAINT "ShoppingPosting_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShoppingPosting" ADD CONSTRAINT "ShoppingPosting_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ShoppingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_shoppingPostingId_fkey"
    FOREIGN KEY ("shoppingPostingId") REFERENCES "ShoppingPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
