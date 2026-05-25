// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest"

const opsEventFindFirst = vi.fn()
const opsEventCreate = vi.fn()
const userFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    opsEvent: {
      findFirst: opsEventFindFirst,
      create: opsEventCreate,
    },
    user: {
      findMany: userFindMany,
    },
  },
}))

vi.mock("@/lib/email", () => ({
  sendOpsAlertEmail: vi.fn().mockResolvedValue(true),
}))

describe("sendAlert", () => {
  beforeEach(() => {
    vi.resetModules()
    opsEventFindFirst.mockReset()
    opsEventCreate.mockReset()
    userFindMany.mockReset()
    delete process.env.E2E_TEST
    delete process.env.DISCORD_OPS_WEBHOOK_URL
    delete process.env.TELEGRAM_BOT_TOKEN
    opsEventFindFirst.mockResolvedValue(null)
    opsEventCreate.mockResolvedValue({ id: "evt1" })
    userFindMany.mockResolvedValue([])
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
  })

  it("persists OpsEvent even when channels skipped", async () => {
    process.env.E2E_TEST = "true"
    const { sendAlert } = await import("../alert")
    const result = await sendAlert({
      severity: "error",
      source: "test",
      title: "Test",
      body: "user@example.com failed",
    })
    expect(result.eventId).toBe("evt1")
    expect(opsEventCreate).toHaveBeenCalledOnce()
    const data = opsEventCreate.mock.calls[0][0].data
    expect(data.body).not.toContain("user@example.com")
  })

  it("deduplicates by fingerprint within window", async () => {
    opsEventFindFirst.mockResolvedValue({ id: "existing" })
    const { sendAlert } = await import("../alert")
    await sendAlert({
      severity: "error",
      source: "test",
      title: "Dup",
      body: "same",
      fingerprint: "fp:1",
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
