// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const shoppingEventFindFirst = vi.fn()
const shoppingBudgetPreferenceFindFirst = vi.fn()
const shoppingPostingFindUnique = vi.fn()

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
    shoppingPosting: {
      findUnique: (...args: unknown[]) => shoppingPostingFindUnique(...args),
    },
  },
}))

import { encryptFieldAsymmetric, generateKeyPairFromSeed } from "@/lib/crypto"
import { applyShoppingPostings } from "@/lib/shopping-posting-server"

const ENCRYPTED_PAYEE = encryptFieldAsymmetric(
  "Shared purchase",
  generateKeyPairFromSeed(new Uint8Array(32).fill(7)).publicKey,
)

function entry(overrides: {
  kind: string
  type: "expense" | "credit"
  payee?: string
  envelopeId?: string
}) {
  return {
    entryKey: "k1",
    kind: overrides.kind as "own_expense",
    cents: 100,
    type: overrides.type,
    postedOn: "2026-09-01",
    payee: overrides.payee ?? ENCRYPTED_PAYEE,
    envelopeId: overrides.envelopeId ?? "env",
  }
}

describe("applyShoppingPostings kind and type", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    shoppingEventFindFirst.mockReset()
    shoppingBudgetPreferenceFindFirst.mockReset()
    shoppingPostingFindUnique.mockReset()
    shoppingPostingFindUnique.mockResolvedValue(null)
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
      envelopeId: "env",
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

  it("rejects a posting envelope that does not match budget settings", async () => {
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense", envelopeId: "env-other" })],
    })).rejects.toMatchObject({
      status: 400,
      message: "Use the envelope selected in your budget settings",
    })
  })

  it("lets a correction use either direction and still requires an encrypted payee", async () => {
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "correction", type: "credit", payee: "not-encrypted" })],
    })).rejects.toMatchObject({ status: 400, message: "Payee must be encrypted" })
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense", payee: "not-encrypted" })],
    })).rejects.toMatchObject({ status: 400, message: "Payee must be encrypted" })
  })
})
