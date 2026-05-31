import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationIngestDedupe: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/notification-ingest-idempotency", () => ({
  normalizeIdempotencyKey: vi.fn((raw: string | null | undefined) => raw?.trim() || null),
  notificationIngestAlreadySeen: vi.fn().mockResolvedValue(false),
  claimNotificationIngestIdempotency: vi.fn().mockResolvedValue("claimed"),
  releaseNotificationIngestIdempotency: vi.fn().mockResolvedValue(undefined),
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

import { parseBankAlertText } from "@/lib/bank-alert-parser"
import {
  claimNotificationIngestIdempotency,
  notificationIngestAlreadySeen,
  releaseNotificationIngestIdempotency,
} from "@/lib/notification-ingest-idempotency"
import { ingestNotificationAlert } from "@/lib/notification-ingest"
import { requirePremiumOrTrial } from "@/lib/subscription"

describe("ingestNotificationAlert", () => {
  const openAiKey = "test-openai-key"

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = openAiKey
    vi.mocked(requirePremiumOrTrial).mockResolvedValue(true)
    vi.mocked(notificationIngestAlreadySeen).mockResolvedValue(false)
    vi.mocked(claimNotificationIngestIdempotency).mockResolvedValue("claimed")
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

  it("rejects oversized alert text", async () => {
    const out = await ingestNotificationAlert("u1", { text: "x".repeat(9000) })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(413)
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
    vi.mocked(notificationIngestAlreadySeen).mockResolvedValue(true)
    const out = await ingestNotificationAlert("u1", {
      text: "Debit $5",
      idempotencyKey: "k1",
    })
    expect(out).toEqual({ ok: true, deduplicated: true })
  })

  it("releases idempotency claim when parsing fails", async () => {
    vi.mocked(parseBankAlertText).mockResolvedValue(null)
    await ingestNotificationAlert("u1", { text: "nonsense", idempotencyKey: "k2" })
    expect(releaseNotificationIngestIdempotency).toHaveBeenCalledWith("u1", "k2")
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
