// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const envelopeFindFirst = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    shoppingMember: {
      findFirst: (...args: unknown[]) => shoppingMemberFindFirst(...args),
    },
    envelope: { findFirst: (...args: unknown[]) => envelopeFindFirst(...args) },
    shoppingBudgetPreference: {
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
  },
}))

import { updatePreference } from "@/lib/shopping-server"

describe("updatePreference", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    envelopeFindFirst.mockReset()
    shoppingMemberFindFirst.mockResolvedValue({
      id: "mem",
      role: "member",
      status: "active",
      group: {
        id: "g1",
        lifecycle: "active",
        keyVersion: 1,
        eventSequence: 0,
        membershipRevision: 1,
      },
    })
  })

  it("rejects enabling budgeting without an envelope", async () => {
    await expect(
      updatePreference({
        groupId: "g1",
        userId: "u1",
        expectedVersion: 1,
        enabled: true,
        envelopeId: null,
      }),
    ).rejects.toMatchObject({
      name: "ShoppingHttpError",
      message: "Choose one of your envelopes",
      status: 400,
    })
    expect(envelopeFindFirst).not.toHaveBeenCalled()
  })
})
