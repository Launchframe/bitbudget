// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const shoppingEventFindFirst = vi.fn()
const shoppingBudgetPreferenceFindFirst = vi.fn()
const shoppingPostingFindUnique = vi.fn()
const shoppingPostingCreate = vi.fn()
const shoppingPostingUpdateMany = vi.fn()
const envelopeFindFirst = vi.fn()
const transactionFindFirst = vi.fn()
const transactionCreate = vi.fn()
const transactionImpl = vi.fn()

vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn(async () => null),
  usdToSats: vi.fn(() => 0),
}))

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
      create: (...args: unknown[]) => shoppingPostingCreate(...args),
      updateMany: (...args: unknown[]) => shoppingPostingUpdateMany(...args),
    },
    envelope: {
      findFirst: (...args: unknown[]) => envelopeFindFirst(...args),
    },
    transaction: {
      findFirst: (...args: unknown[]) => transactionFindFirst(...args),
      create: (...args: unknown[]) => transactionCreate(...args),
    },
    $transaction: (arg: unknown) => transactionImpl(arg),
  },
}))

import { encryptFieldAsymmetric, generateKeyPairFromSeed } from "@/lib/crypto"
import { applyShoppingPostings, skipShoppingPosting } from "@/lib/shopping-posting-server"

function openPref(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    preferenceVersion: 1,
    envelopeId: "env",
    catchUpApproved: false,
    enabledAtSequence: 1,
    ...overrides,
  }
}

function txClient(overrides: {
  pref?: () => Promise<unknown>
  posting?: () => Promise<unknown>
  envelope?: () => Promise<unknown>
}) {
  return {
    shoppingBudgetPreference: {
      findFirst: overrides.pref ?? (() => Promise.resolve(openPref())),
    },
    shoppingPosting: {
      findUnique: overrides.posting ?? (() => Promise.resolve(null)),
      create: (...args: unknown[]) => shoppingPostingCreate(...args),
      updateMany: (...args: unknown[]) => shoppingPostingUpdateMany(...args),
    },
    envelope: {
      findFirst: overrides.envelope ?? (() => Promise.resolve({ id: "env" })),
    },
    transaction: {
      findFirst: (...args: unknown[]) => transactionFindFirst(...args),
      create: (...args: unknown[]) => transactionCreate(...args),
    },
  }
}

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
    shoppingPostingCreate.mockReset()
    shoppingPostingUpdateMany.mockReset()
    envelopeFindFirst.mockReset()
    transactionFindFirst.mockReset()
    transactionCreate.mockReset()
    transactionImpl.mockReset()
    shoppingPostingFindUnique.mockResolvedValue(null)
    transactionImpl.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient({})))
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

  it("rejects a posting when budget settings have no envelope", async () => {
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref({ envelopeId: null }))
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })).rejects.toMatchObject({
      status: 400,
      message: "Use the envelope selected in your budget settings",
    })
    expect(transactionImpl).not.toHaveBeenCalled()
  })

  it("rejects an event from before the opt-in point", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 2 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref({ enabledAtSequence: 5 }))
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })).rejects.toMatchObject({
      status: 409,
      message: "This purchase is from before you turned budgeting on.",
    })
    expect(transactionImpl).not.toHaveBeenCalled()
  })

  it("does not turn a skipped row into a budget transaction", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "skipped", transactions: [] }),
      })),
    )
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.skipped).toEqual(["k1"])
    expect(result.createdIds).toEqual([])
    expect(shoppingPostingCreate).not.toHaveBeenCalled()
    expect(transactionCreate).not.toHaveBeenCalled()
  })

  it("stops when budget settings change before the write", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        pref: async () => openPref({ preferenceVersion: 2, envelopeId: "other" }),
      })),
    )
    await expect(applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })).rejects.toMatchObject({ status: 409 })
    expect(shoppingPostingCreate).not.toHaveBeenCalled()
    expect(transactionCreate).not.toHaveBeenCalled()
  })

  it("returns the existing transaction when the row was already added", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "posted", transactions: [{ id: "txn-1" }] }),
      })),
    )
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.createdIds).toEqual(["txn-1"])
    expect(transactionCreate).not.toHaveBeenCalled()
  })

  it("writes a new transaction on the saved envelope", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    shoppingPostingCreate.mockResolvedValue({ id: "post-1" })
    transactionFindFirst.mockResolvedValue(null)
    transactionCreate.mockResolvedValue({ id: "txn-new" })
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({ posting: async () => null })),
    )
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.createdIds).toEqual(["txn-new"])
    expect(transactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        envelopeId: "env",
        shoppingPostingId: "post-1",
        payee: ENCRYPTED_PAYEE,
      }),
    })
  })

  it("marks the row when the envelope is gone", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    shoppingPostingCreate.mockResolvedValue({ id: "post-1" })
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => null,
        envelope: async () => null,
      })),
    )
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.needsAttention).toEqual(["k1"])
    expect(shoppingPostingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "needs_attention" }),
    })
    expect(transactionCreate).not.toHaveBeenCalled()
  })

  it("does not post when the row was skipped during the write", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    shoppingPostingUpdateMany.mockResolvedValue({ count: 0 })
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "needs_attention", transactions: [] }),
      })),
    )
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.skipped).toEqual(["k1"])
    expect(transactionCreate).not.toHaveBeenCalled()
  })

  it("posts a row that was waiting on an envelope", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    shoppingPostingUpdateMany.mockResolvedValue({ count: 1 })
    transactionFindFirst.mockResolvedValue(null)
    transactionCreate.mockResolvedValue({ id: "txn-new" })
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "needs_attention", transactions: [] }),
      })),
    )
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.createdIds).toEqual(["txn-new"])
    expect(shoppingPostingCreate).not.toHaveBeenCalled()
    expect(transactionCreate).toHaveBeenCalled()
  })

  it("keeps an existing transaction when the write hits a unique conflict", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    shoppingPostingFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "p1", status: "posted", transactions: [{ id: "txn-9" }] })
    transactionImpl.mockRejectedValue({ code: "P2002" })
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.createdIds).toEqual(["txn-9"])
  })

  it("reports a skip when a unique conflict leaves no transaction", async () => {
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1", sequence: 5 })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
    shoppingPostingFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "p1", status: "skipped", transactions: [] })
    transactionImpl.mockRejectedValue({ code: "P2002" })
    const result = await applyShoppingPostings({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      preferenceVersion: 1,
      projectionRevision: 1,
      entries: [entry({ kind: "own_expense", type: "expense" })],
    })
    expect(result.skipped).toEqual(["k1"])
    expect(result.createdIds).toEqual([])
  })
})

describe("skipShoppingPosting", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    shoppingEventFindFirst.mockReset()
    shoppingBudgetPreferenceFindFirst.mockReset()
    shoppingPostingCreate.mockReset()
    shoppingPostingUpdateMany.mockReset()
    transactionImpl.mockReset()
    shoppingMemberFindFirst.mockResolvedValue({
      id: "mem",
      role: "member",
      status: "active",
      group: { lifecycle: "active" },
    })
    shoppingEventFindFirst.mockResolvedValue({ id: "ev", groupId: "g1" })
    shoppingBudgetPreferenceFindFirst.mockResolvedValue(openPref())
  })

  it("refuses to skip a row that is already in the budget", async () => {
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "posted", transactions: [{ id: "txn-1" }] }),
      })),
    )
    await expect(skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      entryKey: "k1",
      preferenceVersion: 1,
    })).rejects.toMatchObject({ status: 409, message: "This is already in your budget" })
    expect(shoppingPostingCreate).not.toHaveBeenCalled()
    expect(shoppingPostingUpdateMany).not.toHaveBeenCalled()
  })

  it("leaves an already skipped row unchanged", async () => {
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "skipped", transactions: [] }),
      })),
    )
    await skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      entryKey: "k1",
      preferenceVersion: 1,
    })
    expect(shoppingPostingCreate).not.toHaveBeenCalled()
    expect(shoppingPostingUpdateMany).not.toHaveBeenCalled()
  })

  it("records a skip only when the row is not already posted", async () => {
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({ posting: async () => null })),
    )
    await skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      entryKey: "k1",
      preferenceVersion: 1,
    })
    expect(shoppingPostingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "skipped", entryKey: "k1" }),
    })
  })

  it("stops skipping when settings change before the write", async () => {
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        pref: async () => openPref({ preferenceVersion: 4 }),
      })),
    )
    await expect(skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      entryKey: "k1",
      preferenceVersion: 1,
    })).rejects.toMatchObject({ status: 409 })
    expect(shoppingPostingCreate).not.toHaveBeenCalled()
  })

  it("does not skip when the row was added during the write", async () => {
    shoppingPostingUpdateMany.mockResolvedValue({ count: 0 })
    transactionImpl.mockImplementation(async (fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) =>
      fn(txClient({
        posting: async () => ({ id: "p1", status: "needs_attention", transactions: [] }),
      })),
    )
    await expect(skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      entryKey: "k1",
      preferenceVersion: 1,
    })).rejects.toMatchObject({ status: 409, message: "This is already in your budget" })
  })

  it("rejects a skip for an unknown shared event", async () => {
    shoppingEventFindFirst.mockResolvedValue(null)
    await expect(skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "missing",
      entryKey: "k1",
      preferenceVersion: 1,
    })).rejects.toMatchObject({ status: 404, message: "Shared event not found" })
    expect(transactionImpl).not.toHaveBeenCalled()
  })

  it("keeps a posted row when skip loses a unique conflict", async () => {
    transactionImpl.mockRejectedValue({ code: "P2002" })
    shoppingPostingFindUnique.mockResolvedValue({
      id: "p1",
      status: "posted",
      transactions: [{ id: "txn-1" }],
    })
    await expect(skipShoppingPosting({
      userId: "u1",
      groupId: "g1",
      eventId: "ev",
      entryKey: "k1",
      preferenceVersion: 1,
    })).rejects.toMatchObject({ status: 409, message: "This is already in your budget" })
  })
})
