// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/encryption-reset-server", () => ({
  encryptionResetRequiresReauth: vi.fn(),
  resetUserEncryption: vi.fn(),
}))

import { auth } from "@/lib/auth"
import { getToken } from "next-auth/jwt"
import { encryptionResetRequiresReauth, resetUserEncryption } from "@/lib/encryption-reset-server"
import { POST } from "@/app/api/user/encryption/reset/route"
import { ENCRYPTION_RESET_CONFIRM } from "@/lib/encryption-reset"

describe("POST /api/user/encryption/reset", () => {
  const userId = "user_reset"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(getToken).mockResolvedValue({ iat: Math.floor(Date.now() / 1000) } as never)
    vi.mocked(encryptionResetRequiresReauth).mockReturnValue(false)
    vi.mocked(resetUserEncryption).mockResolvedValue({
      mode: "encrypted_data",
      transactionsDeleted: 1,
      envelopesDeleted: 0,
    })
  })

  function postRequest(body: unknown) {
    return new NextRequest("http://localhost/api/user/encryption/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("returns 401 when unsigned in", async () => {
    vi.mocked(auth).mockResolvedValue(null)
    const res = await POST(postRequest({ mode: "encrypted_data", confirm: ENCRYPTION_RESET_CONFIRM }))
    expect(res.status).toBe(401)
  })

  it("returns 403 REAUTH when session is too old", async () => {
    vi.mocked(encryptionResetRequiresReauth).mockReturnValue(true)
    const res = await POST(postRequest({ mode: "encrypted_data", confirm: ENCRYPTION_RESET_CONFIRM }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.code).toBe("REAUTH_REQUIRED")
    expect(resetUserEncryption).not.toHaveBeenCalled()
  })

  it("rejects missing confirmation text", async () => {
    const res = await POST(postRequest({ mode: "encrypted_data", confirm: "reset" }))
    expect(res.status).toBe(400)
    expect(resetUserEncryption).not.toHaveBeenCalled()
  })

  it("rejects unknown reset mode", async () => {
    const res = await POST(postRequest({ mode: "wipe", confirm: ENCRYPTION_RESET_CONFIRM }))
    expect(res.status).toBe(400)
  })

  it("runs reset for valid request", async () => {
    const res = await POST(
      postRequest({ mode: "all_data", confirm: ENCRYPTION_RESET_CONFIRM }),
    )
    expect(res.status).toBe(200)
    expect(resetUserEncryption).toHaveBeenCalledWith({ userId, mode: "all_data" })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.mode).toBe("encrypted_data")
  })

  it("asks getToken for the secure cookie when the auth URL is https", async () => {
    const prevAuth = process.env.AUTH_URL
    const prevNext = process.env.NEXTAUTH_URL
    process.env.AUTH_URL = "https://app.bitbudget.example"
    delete process.env.NEXTAUTH_URL
    try {
      const res = await POST(
        postRequest({ mode: "encrypted_data", confirm: ENCRYPTION_RESET_CONFIRM }),
      )
      expect(res.status).toBe(200)
      expect(getToken).toHaveBeenCalledWith(
        expect.objectContaining({ secureCookie: true, secret: process.env.AUTH_SECRET }),
      )
    } finally {
      if (prevAuth === undefined) delete process.env.AUTH_URL
      else process.env.AUTH_URL = prevAuth
      if (prevNext === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = prevNext
    }
  })

  it("returns 403 when the session token belongs to a different user", async () => {
    vi.mocked(getToken).mockResolvedValue({ id: "someone-else", iat: Math.floor(Date.now() / 1000) } as never)
    const res = await POST(postRequest({ mode: "encrypted_data", confirm: ENCRYPTION_RESET_CONFIRM }))
    expect(res.status).toBe(403)
    expect(resetUserEncryption).not.toHaveBeenCalled()
  })
})