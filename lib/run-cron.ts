import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { prisma } from "@/lib/db"
import { sendAlert } from "@/lib/alert"
import { scrubAlertText } from "@/lib/sentry-scrub"

export interface CronResult {
  processed?: number
  [key: string]: unknown
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

    const safeMessage = scrubAlertText(errorMessage).slice(0, 500)

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        status: "failure",
        finishedAt: new Date(),
        durationMs,
        errorClass,
        errorMessage: safeMessage,
      },
    })

    Sentry.captureException(err, { tags: { cron: name } })
    await sendAlert({
      severity: "error",
      source: `cron/${name}`,
      title: `Cron failed: ${name}`,
      body: `${errorClass}: ${safeMessage}`,
      fingerprint: `cron:${name}:failure`,
      runbookUrl: "https://github.com/Launchframe/bitbudget/blob/main/docs/ops/triage.md#cron-failure",
    })

    return NextResponse.json(
      { error: "Processing failed", message: safeMessage },
      { status: 500 },
    )
  }
}
