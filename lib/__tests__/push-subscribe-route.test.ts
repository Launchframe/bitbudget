// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const requirePremiumMock = vi.fn()
const deleteManyMock = vi.fn()
const upsertMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subscription")>()
  return {
    ...actual,
    requirePremium: (...args: unknown[]) => requirePremiumMock(...args),
  }
})
vi.mock("@/lib/db", () => ({
  prisma: {
    pushSubscription: {
      deleteMany: (...args: unknown[]) => deleteManyMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}))

import { POST as pushSubscribePost } from "@/app/api/push/subscribe/route"

const userId = "user_push_owner"
const endpoint = "https://push.example/sub/abc"

describe("POST /api/push/subscribe ownership", () => {
  beforeEach(() => {
    authMock.mockReset()
    requirePremiumMock.mockReset()
    deleteManyMock.mockReset()
    upsertMock.mockReset()
    authMock.mockResolvedValue({ user: { id: userId } })
    requirePremiumMock.mockResolvedValue(true)
    deleteManyMock.mockResolvedValue({ count: 1 })
    upsertMock.mockResolvedValue({})
  })

  it("removes other users' rows for the endpoint before upsert", async () => {
    const req = new NextRequest("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "p256", auth: "auth" },
      }),
    })

    const res = await pushSubscribePost(req)
    expect(res.status).toBe(201)
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { endpoint, userId: { not: userId } },
    })
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint },
        update: { p256dh: "p256", auth: "auth" },
      }),
    )
    const upsertArg = upsertMock.mock.calls[0]?.[0] as { update?: Record<string, unknown> }
    expect(upsertArg.update).not.toHaveProperty("userId")
  })
})
