// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { PUT } from "@/app/api/user/public-key/route"

describe("PUT /api/user/public-key", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: "user_1" } } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as never)
  })

  function put(body: unknown) {
    return new Request("http://localhost/api/user/public-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("rejects a public key while the wrapped privacy key is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ encryptedPrivacyKey: null } as never)
    const res = await PUT(put({ publicKey: "ab".repeat(32) }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("ENCRYPTION_NOT_CONFIGURED")
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("saves a public key after a passphrase is configured", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ encryptedPrivacyKey: "wrapped" } as never)
    const res = await PUT(put({ publicKey: "cd".repeat(32) }))
    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { publicKey: "cd".repeat(32) },
    })
  })
})
