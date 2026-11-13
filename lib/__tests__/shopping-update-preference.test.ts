// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const envelopeFindFirst = vi.fn()
const preferenceFindFirst = vi.fn()
const preferenceUpdateMany = vi.fn()
const preferenceFindFirstOrThrow = vi.fn()
const queryRaw = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    shoppingMember: {
      findFirst: (...args: unknown[]) => shoppingMemberFindFirst(...args),
    },
    envelope: { findFirst: (...args: unknown[]) => envelopeFindFirst(...args) },
    shoppingBudgetPreference: {
      findFirst: (...args: unknown[]) => preferenceFindFirst(...args),
      updateMany: (...args: unknown[]) => preferenceUpdateMany(...args),
      findFirstOrThrow: (...args: unknown[]) => preferenceFindFirstOrThrow(...args),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: (...args: unknown[]) => queryRaw(...args),
        shoppingBudgetPreference: {
          findFirst: (...args: unknown[]) => preferenceFindFirst(...args),
          updateMany: (...args: unknown[]) => preferenceUpdateMany(...args),
          findFirstOrThrow: (...args: unknown[]) => preferenceFindFirstOrThrow(...args),
        },
      }),
  },
}))

import { updatePreference } from "@/lib/shopping-server"

function activeMember(eventSequence = 0) {
  return {
    id: "mem",
    role: "member",
    status: "active",
    group: {
      id: "g1",
      lifecycle: "active",
      keyVersion: 1,
      eventSequence,
      membershipRevision: 1,
    },
  }
}

describe("updatePreference", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    envelopeFindFirst.mockReset()
    preferenceFindFirst.mockReset()
    preferenceUpdateMany.mockReset()
    preferenceFindFirstOrThrow.mockReset()
    shoppingMemberFindFirst.mockResolvedValue(activeMember(0))
    preferenceUpdateMany.mockResolvedValue({ count: 1 })
    preferenceFindFirstOrThrow.mockResolvedValue({ id: "pref" })
    queryRaw.mockReset()
    queryRaw.mockResolvedValue([{ eventSequence: 0 }])
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

  it("rejects Savings and archived envelopes", async () => {
    envelopeFindFirst.mockResolvedValue(null)
    await expect(
      updatePreference({
        groupId: "g1",
        userId: "u1",
        expectedVersion: 1,
        enabled: true,
        envelopeId: "sav",
      }),
    ).rejects.toMatchObject({ status: 400, message: "Choose one of your envelopes" })
    expect(envelopeFindFirst).toHaveBeenCalledWith({
      where: {
        id: "sav",
        userId: "u1",
        deletedAt: null,
        archived: false,
        systemRole: null,
      },
    })
    expect(preferenceUpdateMany).not.toHaveBeenCalled()
  })

  it("starts the opt-in at the server's next event, not a client sequence", async () => {
    shoppingMemberFindFirst.mockResolvedValue(activeMember(7))
    queryRaw.mockResolvedValue([{ eventSequence: 40 }])
    envelopeFindFirst.mockResolvedValue({ id: "env" })
    preferenceFindFirst.mockResolvedValue({
      enabled: false,
      catchUpApproved: false,
      enabledAtSequence: null,
      envelopeId: null,
      preferenceVersion: 1,
    })
    await updatePreference({
      groupId: "g1",
      userId: "u1",
      expectedVersion: 1,
      enabled: true,
      envelopeId: "env",
      catchUpApproved: false,
    })
    expect(preferenceUpdateMany).toHaveBeenCalledWith({
      where: { groupId: "g1", userId: "u1", preferenceVersion: 1 },
      data: expect.objectContaining({
        enabled: true,
        envelopeId: "env",
        catchUpApproved: false,
        enabledAtSequence: 41,
        preferenceVersion: 2,
      }),
    })
    expect(String.raw(queryRaw.mock.calls[0]?.[0] as TemplateStringsArray)).toContain("FOR UPDATE")
  })

  it("keeps the opt-in point when only the envelope changes", async () => {
    envelopeFindFirst.mockResolvedValue({ id: "env-new" })
    preferenceFindFirst.mockResolvedValue({
      enabled: true,
      catchUpApproved: false,
      enabledAtSequence: 4,
      envelopeId: "env-old",
      preferenceVersion: 2,
    })
    await updatePreference({
      groupId: "g1",
      userId: "u1",
      expectedVersion: 2,
      enabled: true,
      envelopeId: "env-new",
      catchUpApproved: false,
    })
    expect(preferenceUpdateMany).toHaveBeenCalledWith({
      where: { groupId: "g1", userId: "u1", preferenceVersion: 2 },
      data: expect.objectContaining({
        envelopeId: "env-new",
        enabledAtSequence: 4,
        catchUpApproved: false,
      }),
    })
  })

  it("moves the opt-in forward when catch-up is turned off", async () => {
    queryRaw.mockResolvedValue([{ eventSequence: 40 }])
    envelopeFindFirst.mockResolvedValue({ id: "env" })
    preferenceFindFirst.mockResolvedValue({
      enabled: true,
      catchUpApproved: true,
      enabledAtSequence: 4,
      envelopeId: "env",
      preferenceVersion: 2,
    })
    await updatePreference({
      groupId: "g1",
      userId: "u1",
      expectedVersion: 2,
      enabled: true,
      envelopeId: "env",
      catchUpApproved: false,
    })
    expect(preferenceUpdateMany).toHaveBeenCalledWith({
      where: { groupId: "g1", userId: "u1", preferenceVersion: 2 },
      data: expect.objectContaining({
        catchUpApproved: false,
        enabledAtSequence: 41,
      }),
    })
  })

  it("does not store an unsaved envelope when budgeting is turned off", async () => {
    preferenceFindFirst.mockResolvedValue({
      enabled: true,
      catchUpApproved: true,
      enabledAtSequence: 4,
      envelopeId: "env-saved",
      preferenceVersion: 2,
    })
    await updatePreference({
      groupId: "g1",
      userId: "u1",
      expectedVersion: 2,
      enabled: false,
      envelopeId: "env-draft",
      catchUpApproved: true,
    })
    expect(envelopeFindFirst).not.toHaveBeenCalled()
    expect(preferenceUpdateMany).toHaveBeenCalledWith({
      where: { groupId: "g1", userId: "u1", preferenceVersion: 2 },
      data: expect.objectContaining({
        enabled: false,
        envelopeId: "env-saved",
        catchUpApproved: false,
        enabledAtSequence: 4,
      }),
    })
  })

  it("rejects when the group row cannot be locked", async () => {
    queryRaw.mockResolvedValue([])
    envelopeFindFirst.mockResolvedValue({ id: "env" })
    preferenceFindFirst.mockResolvedValue({
      enabled: false,
      catchUpApproved: false,
      enabledAtSequence: null,
      envelopeId: null,
      preferenceVersion: 1,
    })
    await expect(
      updatePreference({
        groupId: "g1",
        userId: "u1",
        expectedVersion: 1,
        enabled: true,
        envelopeId: "env",
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(preferenceUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects a stale settings version before writing", async () => {
    preferenceFindFirst.mockResolvedValue({
      enabled: true,
      catchUpApproved: false,
      enabledAtSequence: 4,
      envelopeId: "env",
      preferenceVersion: 3,
    })
    await expect(
      updatePreference({
        groupId: "g1",
        userId: "u1",
        expectedVersion: 2,
        enabled: false,
        envelopeId: null,
      }),
    ).rejects.toMatchObject({ status: 409 })
    expect(preferenceUpdateMany).not.toHaveBeenCalled()
  })
})
