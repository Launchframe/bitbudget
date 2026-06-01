import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const requirePremiumOrTrialMock = vi.fn()
const requirePremiumMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subscription")>()
  return {
    ...actual,
    requirePremiumOrTrial: (...args: unknown[]) => requirePremiumOrTrialMock(...args),
    requirePremium: (...args: unknown[]) => requirePremiumMock(...args),
  }
})

import { POST as voiceParsePost } from "@/app/api/voice/parse/route"
import { POST as receiptScanPost } from "@/app/api/receipts/scan/route"
import { POST as pushSubscribePost } from "@/app/api/push/subscribe/route"

const userId = "user_gate_test"

function jsonRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function emptyPost(url: string): NextRequest {
  return new NextRequest(url, { method: "POST" })
}

/** Minimal JPEG magic (≥12 bytes per resolveReceiptFileKind) so scan hits premium gating. */
function receiptScanPostWithFile(url: string): NextRequest {
  const bytes = new Uint8Array(12)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[3] = 0xe0
  const form = new FormData()
  form.append("file", new File([bytes], "scan.jpg", { type: "image/jpeg" }))
  return new NextRequest(url, { method: "POST", body: form })
}

describe("Premium API route gating", () => {
  const envSnapshot = { openai: process.env.OPENAI_API_KEY }

  beforeEach(() => {
    authMock.mockReset()
    requirePremiumOrTrialMock.mockReset()
    requirePremiumMock.mockReset()
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    if (envSnapshot.openai !== undefined) {
      process.env.OPENAI_API_KEY = envSnapshot.openai
    } else {
      delete process.env.OPENAI_API_KEY
    }
  })

  describe("POST /api/voice/parse", () => {
    it("returns 401 when unauthenticated", async () => {
      authMock.mockResolvedValue(null)
      const res = await voiceParsePost(
        jsonRequest("http://localhost/api/voice/parse", { transcript: "coffee 5" }),
      )
      expect(res.status).toBe(401)
      expect(requirePremiumOrTrialMock).not.toHaveBeenCalled()
    })

    it("returns 403 when requirePremiumOrTrial denies", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumOrTrialMock.mockResolvedValue(false)
      const res = await voiceParsePost(
        jsonRequest("http://localhost/api/voice/parse", { transcript: "coffee 5" }),
      )
      expect(res.status).toBe(403)
      expect(requirePremiumOrTrialMock).toHaveBeenCalledWith(userId)
      const body = await res.json()
      expect(body.message).toContain("premium")
      expect(body.message).toContain("trial")
    })

    it("proceeds past gate when trial/premium allowed (not 403)", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumOrTrialMock.mockResolvedValue(true)
      const res = await voiceParsePost(
        jsonRequest("http://localhost/api/voice/parse", { transcript: "coffee 5" }),
      )
      expect(requirePremiumOrTrialMock).toHaveBeenCalledWith(userId)
      expect(res.status).not.toBe(403)
      expect(res.status).not.toBe(401)
    })
  })

  describe("POST /api/receipts/scan", () => {
    it("returns 403 for free users via requirePremiumOrTrial (multipart upload)", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumOrTrialMock.mockResolvedValue(false)
      const res = await receiptScanPost(
        receiptScanPostWithFile("http://localhost/api/receipts/scan"),
      )
      expect(res.status).toBe(403)
      expect(requirePremiumOrTrialMock).toHaveBeenCalledWith(userId)
    })

    it("returns 403 for free users on non-multipart POST (JSON probe)", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumOrTrialMock.mockResolvedValue(false)
      const res = await receiptScanPost(
        jsonRequest("http://localhost/api/receipts/scan", {}),
      )
      expect(res.status).toBe(403)
      expect(requirePremiumOrTrialMock).toHaveBeenCalledWith(userId)
      const body = await res.json()
      expect(body.message).toMatch(/premium|trial/i)
    })

    it("uses the same gate as voice when allowed (not 403)", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumOrTrialMock.mockResolvedValue(true)
      const res = await receiptScanPost(
        receiptScanPostWithFile("http://localhost/api/receipts/scan"),
      )
      expect(requirePremiumOrTrialMock).toHaveBeenCalledWith(userId)
      expect(res.status).not.toBe(403)
      expect(res.status).not.toBe(401)
    })
  })

  describe("POST /api/push/subscribe", () => {
    it("returns 403 for trial-only users via requirePremium", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumMock.mockResolvedValue(false)
      const res = await pushSubscribePost(
        jsonRequest("http://localhost/api/push/subscribe", {
          endpoint: "https://push.example/x",
          keys: { p256dh: "a", auth: "b" },
        }),
      )
      expect(res.status).toBe(403)
      expect(requirePremiumMock).toHaveBeenCalledWith(userId)
      expect(requirePremiumOrTrialMock).not.toHaveBeenCalled()
    })

    it("proceeds past requirePremium when paid premium", async () => {
      authMock.mockResolvedValue({ user: { id: userId } })
      requirePremiumMock.mockResolvedValue(true)
      const res = await pushSubscribePost(emptyPost("http://localhost/api/push/subscribe"))
      expect(requirePremiumMock).toHaveBeenCalledWith(userId)
      expect(res.status).not.toBe(403)
    })
  })
})
