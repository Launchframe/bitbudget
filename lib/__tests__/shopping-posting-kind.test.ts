// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const shoppingEventFindFirst = vi.fn()
const shoppingBudgetPreferenceFindFirst = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    shoppingMember: {
      findFirst: (...args: unknown[]) => shoppingMemberFindFirst(...args),
    },
    shoppingEvent: {
      findFirst: (...args: unknown[]) => shoppingEventFindFirst(...args),
    },
    shoppingBudgetPreference: {
      findFirst: (...args: unknown[]) => shoppingBudgetPreferenceFindFirst(...args),
    },
  },
}))

import { applyShoppingPostings } from "@/lib/shopping-posting-server"

function entry(overrides: { kind: string; type: "expense" | "credit"; payee?: string }) {
  return {
    entryKey: "k1",
    kind: overrides.kind as "own_expense",
    cents: 100,
    type: overrides.type,
    postedOn: "2026-09-01",
    payee: overrides.payee ?? "not-encrypted",
    envelopeId: "env",
  }
}

describe("applyShoppingPostings kind and type", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    shoppingEventFindFirst.mockReset()
    shoppingBudgetPreferenceFindFirst.mockReset()
    shoppingMemberFindFirst.mockResolvedValue({
      id: "mem",
      role: "member",
      status: "active",
      group: { lifecycle: "active" },
    })
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1" })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue({
      enabled: true,
      preferenceVersion: 1,
    })
  })

  it("rejects an expense kind saved as a credit", async () => {
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "credit" })],
    })).rejects.toMatchObject({
      status: 400,
      message: "This shared-list entry cannot be saved that way.",
    })
  })

  it("rejects a credit kind saved as an expense", async () => {
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "advance_recovery", type: "expense" })],
    })).rejects.toMatchObject({
      status: 400,
      message: "This shared-list entry cannot be saved that way.",
    })
  })

  it("lets a correction use either direction and still requires an encrypted payee", async () => {
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "correction", type: "credit" })],
    })).rejects.toMatchObject({ status: 400, message: "Payee must be encrypted" })
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })).rejects.toMatchObject({ status: 400, message: "Payee must be encrypted" })
  })
})
