-- Ops observability: cron run history and alert events.

CREATE TABLE IF NOT EXISTS "CronRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "processed" INTEGER,
    "durationMs" INTEGER,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CronRun_name_startedAt_idx" ON "CronRun"("name", "startedAt");
CREATE INDEX IF NOT EXISTS "CronRun_status_idx" ON "CronRun"("status");
CREATE INDEX IF NOT EXISTS "CronRun_startedAt_idx" ON "CronRun"("startedAt");

CREATE TABLE IF NOT EXISTS "OpsEvent" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fingerprint" TEXT,
    "sentryEventId" TEXT,
    "channelStatus" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpsEvent_severity_idx" ON "OpsEvent"("severity");
CREATE INDEX IF NOT EXISTS "OpsEvent_fingerprint_createdAt_idx" ON "OpsEvent"("fingerprint", "createdAt");
CREATE INDEX IF NOT EXISTS "OpsEvent_createdAt_idx" ON "OpsEvent"("createdAt");
