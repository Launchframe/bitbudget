// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"

const cronRunCreate = vi.fn()
const cronRunUpdate = vi.fn()
const captureException = vi.fn()
const sendAlert = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    cronRun: {
      create: cronRunCreate,
      update: cronRunUpdate,
    },
  },
}))

vi.mock("@sentry/nextjs", () => ({
  captureException,
}))

vi.mock("@/lib/alert", () => ({
  sendAlert,
}))

describe("runCron", () => {
  beforeEach(() => {
    vi.resetModules()
    cronRunCreate.mockReset()
    cronRunUpdate.mockReset()
    captureException.mockReset()
    sendAlert.mockReset()
    cronRunCreate.mockResolvedValue({ id: "run1" })
    cronRunUpdate.mockResolvedValue({})
    sendAlert.mockResolvedValue({ sent: true, eventId: "e1" })
  })

  it("records success and returns JSON", async () => {
    const { runCron } = await import("../run-cron")
    const res = await runCron("test-job", async () => ({ processed: 3 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(3)
    expect(cronRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run1" },
        data: expect.objectContaining({ status: "success", processed: 3 }),
      }),
    )
  })

  it("records failure, alerts, and returns 500", async () => {
    const { runCron } = await import("../run-cron")
    const res = await runCron("fail-job", async () => {
      throw new Error("boom")
    })
    expect(res.status).toBe(500)
    expect(captureException).toHaveBeenCalled()
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "cron/fail-job", fingerprint: "cron:fail-job:failure" }),
    )
  })

  it("scrubs PII from errorMessage before storing in CronRun", async () => {
    const { runCron } = await import("../run-cron")
    const res = await runCron("pii-job", async () => {
      throw new Error("Failed for user@example.com")
    })
    expect(res.status).toBe(500)
    const updateCall = cronRunUpdate.mock.calls[0][0]
    expect(updateCall.data.errorMessage).not.toContain("user@example.com")
    expect(updateCall.data.errorMessage).toContain("[redacted-email]")
    const body = await res.json()
    expect(body.message).not.toContain("user@example.com")
  })
})

describe("verifyCronSecret", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET
  })

  it("returns 401 when secret mismatch", async () => {
    process.env.CRON_SECRET = "secret"
    const { verifyCronSecret } = await import("../run-cron")
    const req = {
      headers: { get: (k: string) => (k === "authorization" ? "Bearer wrong" : null) },
    } as unknown as import("next/server").NextRequest
    const res = verifyCronSecret(req)
    expect(res).toBeInstanceOf(NextResponse)
    expect(res?.status).toBe(401)
  })

  it("returns 401 when CRON_SECRET is not configured", async () => {
    const { verifyCronSecret } = await import("../run-cron")
    const req = {
      headers: { get: (k: string) => (k === "authorization" ? "Bearer undefined" : null) },
    } as unknown as import("next/server").NextRequest
    const res = verifyCronSecret(req)
    expect(res).toBeInstanceOf(NextResponse)
    expect(res?.status).toBe(401)
  })
})
