-- Referral program + survey (idempotent for re-runs)

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "premiumGratisUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "premiumTrialUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredByCodeId" TEXT;

CREATE TABLE IF NOT EXISTS "ReferralCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "label" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE INDEX IF NOT EXISTS "ReferralCode_ownerId_idx" ON "ReferralCode"("ownerId");
CREATE INDEX IF NOT EXISTS "ReferralCode_type_idx" ON "ReferralCode"("type");

DO $$ BEGIN
 ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "shareMethod" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_refereeId_key" ON "Referral"("refereeId");
CREATE INDEX IF NOT EXISTS "Referral_referrerId_idx" ON "Referral"("referrerId");
CREATE INDEX IF NOT EXISTS "Referral_codeId_idx" ON "Referral"("codeId");

DO $$ BEGIN
 ALTER TABLE "Referral" ADD CONSTRAINT "Referral_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "User" ADD CONSTRAINT "User_referredByCodeId_fkey" FOREIGN KEY ("referredByCodeId") REFERENCES "ReferralCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Survey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "rating" TEXT,
    "favoriteFeature" TEXT,
    "leastFavorite" TEXT,
    "comments" TEXT,
    "canContact" BOOLEAN,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Survey_userId_key" ON "Survey"("userId");
CREATE INDEX IF NOT EXISTS "Survey_completedAt_idx" ON "Survey"("completedAt");

DO $$ BEGIN
 ALTER TABLE "Survey" ADD CONSTRAINT "Survey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
