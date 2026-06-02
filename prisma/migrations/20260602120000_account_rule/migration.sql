-- AccountRule: user-defined automation rules (see prisma/schema.prisma model AccountRule).

CREATE TABLE IF NOT EXISTS "AccountRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountRule_userId_trigger_enabled_idx" ON "AccountRule"("userId", "trigger", "enabled");

DO $$
BEGIN
  ALTER TABLE "AccountRule" ADD CONSTRAINT "AccountRule_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
