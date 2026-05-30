import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    pendingTransaction: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/subscription", () => ({
  requirePremiumOrTrial: vi.fn().mockResolvedValue(true),
  assertPremiumTrialInboxAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock("@/lib/bank-alert-parser", () => ({
  composeBankAlertText: vi.fn((p: { text?: string }) => p.text ?? null),
  parseBankAlertText: vi.fn(),
}))

vi.mock("@/lib/envelope-matcher", () => ({
  matchEnvelope: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/confidence-router", () => ({
  routeTransaction: vi.fn().mockResolvedValue({ route: "pending", id: "pend_1" }),
}))

import { prisma } from "@/lib/db"
import { parseBankAlertText } from "@/lib/bank-alert-parser"
import { ingestNotificationAlert } from "@/lib/notification-ingest"
import { requirePremiumOrTrial } from "@/lib/subscription"

describe("ingestNotificationAlert", () => {
  const openAiKey = "test-openai-key"

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = openAiKey
    vi.mocked(requirePremiumOrTrial).mockResolvedValue(true)
    vi.mocked(prisma.pendingTransaction.findFirst).mockResolvedValue(null)
  })

  it("rejects when not premium", async () => {
    vi.mocked(requirePremiumOrTrial).mockResolvedValue(false)
    const out = await ingestNotificationAlert("u1", { text: "x" })
    expect(out).toEqual({
      ok: false,
      status: 403,
      error: "Forbidden",
      message: "Notification forwarding requires premium or an active premium trial",
    })
  })

  it("requires text", async () => {
    const out = await ingestNotificationAlert("u1", {})
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(400)
  })

  it("returns 503 when OPENAI_API_KEY is unset", async () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const out = await ingestNotificationAlert("u1", { text: "Debit $5" })
      expect(out).toEqual({
        ok: false,
        status: 503,
        error: "Service unavailable",
        message: "Alert parsing is not configured on this server.",
      })
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev
    }
  })

  it("deduplicates on idempotencyKey", async () => {
    vi.mocked(prisma.pendingTransaction.findFirst).mockResolvedValue({ id: "existing" })
    const out = await ingestNotificationAlert("u1", {
      text: "Debit $5",
      idempotencyKey: "k1",
    })
    expect(out).toEqual({ ok: true, deduplicated: true })
  })

  it("routes parsed alert to pending", async () => {
    vi.mocked(parseBankAlertText).mockResolvedValue({
      payee: "Coffee",
      amount: 5,
      date: "2026-05-27",
    })
    const out = await ingestNotificationAlert("u1", { text: "Debit $5 at Coffee" })
    expect(out).toEqual({ ok: true, route: "pending", id: "pend_1" })
  })
})
