// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const findUnique = vi.fn()
const findFirst = vi.fn()
const updateMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    shoppingInvite: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
    shoppingMember: {
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
}))

import { claimInvite, ShoppingHttpError } from "../shopping-server"

describe("claimInvite atomic first-claimant wins", () => {
  beforeEach(() => {
    findUnique.mockReset()
    findFirst.mockReset()
    updateMany.mockReset()
  })

  it("scopes updateMany to pending or same claimant (not any requested)", async () => {
    findUnique.mockResolvedValue({
      id: "inv-1",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: "owner",
      verificationCode: "0123456789abcdef",
      claimantUserId: null,
    })
    findFirst.mockResolvedValue(null)
    updateMany.mockResolvedValue({ count: 1 })

    await claimInvite({
      userId: "claimant-a",
      token: "tokentoken12345678",
      publicKey: "ab".repeat(32),
      keyFingerprint: "cd".repeat(8),
      encryptedClaimantAlias: "AAAA".repeat(20),
      verificationCode: "0123456789abcdef",
    })

    expect(updateMany).toHaveBeenCalledTimes(1)
    const arg = updateMany.mock.calls[0][0] as {
      where: { OR: unknown[]; status?: unknown }
    }
    expect(arg.where.OR).toEqual([
      { status: "pending" },
      { status: "requested", claimantUserId: "claimant-a" },
    ])
    expect(arg.where.status).toBeUndefined()
  })

  it("rejects when another claimant already holds requested", async () => {
    findUnique.mockResolvedValue({
      id: "inv-1",
      status: "requested",
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: "owner",
      verificationCode: "0123456789abcdef",
      claimantUserId: "claimant-a",
    })
    findFirst.mockResolvedValue(null)

    await expect(
      claimInvite({
        userId: "claimant-b",
        token: "tokentoken12345678",
        publicKey: "ab".repeat(32),
        keyFingerprint: "cd".repeat(8),
        encryptedClaimantAlias: "AAAA".repeat(20),
        verificationCode: "0123456789abcdef",
      }),
    ).rejects.toBeInstanceOf(ShoppingHttpError)

    expect(updateMany).not.toHaveBeenCalled()
  })
})
