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

const sendOpsAlertEmail = vi.fn().mockResolvedValue(true)

vi.mock("@/lib/email", () => ({
  sendOpsAlertEmail,
}))

describe("sendAlert", () => {
  beforeEach(() => {
    vi.resetModules()
    opsEventFindFirst.mockReset()
    opsEventCreate.mockReset()
    userFindMany.mockReset()
    sendOpsAlertEmail.mockClear()
    delete process.env.E2E_TEST
    delete process.env.DISCORD_OPS_WEBHOOK_URL
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_OPS_CHAT_ID
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

  it("scrubs PII from persisted title, source, and fingerprint", async () => {
    process.env.E2E_TEST = "true"
    const { sendAlert } = await import("../alert")
    await sendAlert({
      severity: "error",
      source: "sentry/user@example.com",
      title: "Failure for user@example.com",
      body: "same user@example.com",
      fingerprint: "alert:user@example.com",
    })

    const data = opsEventCreate.mock.calls[0][0].data
    expect(data.source).toBe("sentry/[redacted-email]")
    expect(data.title).toBe("Failure for [redacted-email]")
    expect(data.body).toBe("same [redacted-email]")
    expect(data.fingerprint).toBe("alert:[redacted-email]")
  })

  it("scrubs sensitive key-value pairs before persisting alert bodies", async () => {
    process.env.E2E_TEST = "true"
    const { sendAlert } = await import("../alert")
    await sendAlert({
      severity: "error",
      source: "incoming",
      title: "Webhook failed",
      body: 'payload {"password":"hunter2","payee":"Coffee Shop"} token=plain-secret',
    })

    const data = opsEventCreate.mock.calls[0][0].data
    expect(data.body).toContain('"password":[redacted]')
    expect(data.body).toContain('"payee":[redacted]')
    expect(data.body).toContain("token=[redacted]")
    expect(data.body).not.toContain("hunter2")
    expect(data.body).not.toContain("Coffee Shop")
    expect(data.body).not.toContain("plain-secret")
  })

  it("scrubs title in outbound channel messages and email subjects", async () => {
    process.env.DISCORD_OPS_WEBHOOK_URL = "https://discord.example/webhook"
    userFindMany.mockResolvedValue([{ email: "admin@example.com" }])
    const { sendAlert } = await import("../alert")

    await sendAlert({
      severity: "error",
      source: "test",
      title: "Failed user@example.com",
      body: "body",
    })

    const discordBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(discordBody.content).toContain("[redacted-email]")
    expect(discordBody.content).not.toContain("user@example.com")
    expect(sendOpsAlertEmail).toHaveBeenCalledWith(
      "admin@example.com",
      "[BitBudget error] Failed [redacted-email]",
      expect.not.stringContaining("user@example.com"),
    )
  })

  it("escapes alert email HTML", async () => {
    userFindMany.mockResolvedValue([{ email: "admin@example.com" }])
    const { sendAlert } = await import("../alert")

    await sendAlert({
      severity: "error",
      source: "incoming",
      title: "HTML",
      body: '<img src=x onerror="alert(1)">',
    })

    expect(sendOpsAlertEmail).toHaveBeenCalledWith(
      "admin@example.com",
      "[BitBudget error] HTML",
      expect.stringContaining("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"),
    )
    expect(sendOpsAlertEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.not.stringContaining("<img"),
    )
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
