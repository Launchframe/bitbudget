import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { prisma } from "@/lib/db"
import { sendAlert } from "@/lib/alert"

export interface CronResult {
  processed?: number
  [key: string]: unknown
}

export function verifyCronSecret(req: NextRequest): NextResponse | null {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

/** Uniform cron wrapper: persist run, capture failures, alert ops. */
export async function runCron<T extends CronResult>(
  name: string,
  fn: () => Promise<T>,
): Promise<NextResponse> {
  const startedAt = Date.now()
  const run = await prisma.cronRun.create({
    data: { name, status: "running" },
  })

  try {
    const result = await fn()
    const durationMs = Date.now() - startedAt
    const processed =
      typeof result.processed === "number"
        ? result.processed
        : typeof result.sent === "number"
          ? result.sent
          : typeof result.scanned === "number"
            ? result.scanned
            : null

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        durationMs,
        processed,
      },
    })

    return NextResponse.json({ ok: true, ...result, durationMs })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const errorClass = err instanceof Error ? err.constructor.name : "Error"
    const errorMessage = err instanceof Error ? err.message : String(err)

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: "failure",
        finishedAt: new Date(),
        durationMs,
        errorClass,
        errorMessage: errorMessage.slice(0, 500),
      },
    })

    Sentry.captureException(err, { tags: { cron: name } })
    await sendAlert({
      severity: "error",
      source: `cron/${name}`,
      title: `Cron failed: ${name}`,
      body: `${errorClass}: ${errorMessage}`,
      fingerprint: `cron:${name}:failure`,
      runbookUrl: "https://github.com/Launchframe/bitbudget/blob/main/docs/ops/triage.md#cron-failure",
    })

    return NextResponse.json(
      { error: "Processing failed", message: errorMessage },
      { status: 500 },
    )
  }
}
