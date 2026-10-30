// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const shoppingEventFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    shoppingMember: {
      findFirst: (...args: unknown[]) => shoppingMemberFindFirst(...args),
    },
    shoppingEvent: {
      findMany: (...args: unknown[]) => shoppingEventFindMany(...args),
    },
  },
}))

import { listShoppingEvents } from "@/lib/shopping-server"

function eventRow(sequence: number) {
  return {
    id: `e${sequence}`,
    sequence,
    type: "repayment",
    actorMemberId: "mem",
    encryptedPayload: "sg1:0123456789abcdef01234567:abcd",
    keyVersion: 1,
    affectedMemberIds: "[]",
    operationId: `op-${sequence}`,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  }
}

describe("listShoppingEvents", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    shoppingEventFindMany.mockReset()
    shoppingMemberFindFirst.mockResolvedValue({
      id: "mem",
      role: "member",
      status: "active",
      group: { id: "g1", lifecycle: "active" },
    })
  })

  it("returns the previous page ascending and reports when more history remains", async () => {
    shoppingEventFindMany.mockResolvedValue([eventRow(50), eventRow(49), eventRow(48)])
    const page = await listShoppingEvents({
      groupId: "g1",
      userId: "u1",
      beforeSequence: 51,
      limit: 2,
    })
    expect(shoppingEventFindMany).toHaveBeenCalledWith({
      where: { groupId: "g1", sequence: { lt: 51 } },
      orderBy: { sequence: "desc" },
      take: 3,
    })
    expect(page.hasMore).toBe(true)
    expect(page.events.map((event) => event.sequence)).toEqual([49, 50])
  })

  it("walks forward without a phantom extra page", async () => {
    shoppingEventFindMany.mockResolvedValue([eventRow(1), eventRow(2)])
    const page = await listShoppingEvents({
      groupId: "g1",
      userId: "u1",
      afterSequence: 0,
      limit: 2,
    })
    expect(shoppingEventFindMany).toHaveBeenCalledWith({
      where: { groupId: "g1", sequence: { gt: 0 } },
      orderBy: { sequence: "asc" },
      take: 3,
    })
    expect(page.hasMore).toBe(false)
    expect(page.events.map((event) => event.sequence)).toEqual([1, 2])
  })

  it("rejects both cursors before querying", async () => {
    await expect(
      listShoppingEvents({
        groupId: "g1",
        userId: "u1",
        afterSequence: 1,
        beforeSequence: 2,
      }),
    ).rejects.toMatchObject({
      name: "ShoppingHttpError",
      message: "Choose either newer or earlier items, not both.",
      status: 400,
    })
    expect(shoppingEventFindMany).not.toHaveBeenCalled()
  })

  it("rejects a cursor that is not a whole number", async () => {
    await expect(
      listShoppingEvents({ groupId: "g1", userId: "u1", afterSequence: -1 }),
    ).rejects.toMatchObject({ message: "Invalid sequence cursor", status: 400 })
    expect(shoppingEventFindMany).not.toHaveBeenCalled()
  })
})
