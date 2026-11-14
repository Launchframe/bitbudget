import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ENCRYPTION_RESET_CONFIRM,
  parseEncryptionResetMode,
} from "../encryption-reset"
import { resetUserEncryption } from "../encryption-reset-server"

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    transaction: { deleteMany: vi.fn() },
    pendingTransaction: { deleteMany: vi.fn(), updateMany: vi.fn() },
    transactionShortcut: { deleteMany: vi.fn() },
    recurringTransaction: { deleteMany: vi.fn() },
    pendingStatementBatch: { deleteMany: vi.fn() },
    payeeDisplayAlias: { deleteMany: vi.fn() },
    envelope: { deleteMany: vi.fn() },
    user: { update: vi.fn() },
  },
}))

vi.mock("@/lib/shopping-posting-server", () => ({
  suppressAllShoppingPostingsForUser: vi.fn(async () => {}),
}))

import { prisma } from "@/lib/db"
import { suppressAllShoppingPostingsForUser } from "@/lib/shopping-posting-server"

function mockTx(overrides?: {
  txnCount?: number
  envelopeCount?: number
}) {
  return {
    transaction: { deleteMany: vi.fn(async () => ({ count: overrides?.txnCount ?? 0 })) },
    pendingTransaction: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    transactionShortcut: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    recurringTransaction: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    pendingStatementBatch: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    payeeDisplayAlias: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    envelope: { deleteMany: vi.fn(async () => ({ count: overrides?.envelopeCount ?? 0 })) },
    user: { update: vi.fn(async () => ({})) },
  }
}

describe("parseEncryptionResetMode", () => {
  it("accepts the two product modes only", () => {
    expect(parseEncryptionResetMode("encrypted_data")).toBe("encrypted_data")
    expect(parseEncryptionResetMode("all_data")).toBe("all_data")
    expect(parseEncryptionResetMode("RESET")).toBeNull()
    expect(parseEncryptionResetMode(ENCRYPTION_RESET_CONFIRM)).toBeNull()
  })
})

describe("resetUserEncryption", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("clears keys and encrypted rows for encrypted_data without deleting envelopes", async () => {
    const tx = mockTx({ txnCount: 3 })
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const result = await resetUserEncryption({ userId: "u1", mode: "encrypted_data" })
    expect(suppressAllShoppingPostingsForUser).toHaveBeenCalledWith("u1")
    expect(tx.transaction.deleteMany).toHaveBeenCalled()
    expect(tx.transactionShortcut.deleteMany).toHaveBeenCalled()
    expect(tx.recurringTransaction.deleteMany).toHaveBeenCalled()
    expect(tx.pendingStatementBatch.deleteMany).toHaveBeenCalled()
    expect(tx.envelope.deleteMany).not.toHaveBeenCalled()
    expect(tx.payeeDisplayAlias.deleteMany).not.toHaveBeenCalled()
    expect(result).toEqual({ mode: "encrypted_data", transactionsDeleted: 3, envelopesDeleted: 0 })
  })

  it("also deletes envelopes and aliases for all_data", async () => {
    const tx = mockTx({ txnCount: 2, envelopeCount: 5 })
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const result = await resetUserEncryption({ userId: "u1", mode: "all_data" })
    expect(tx.envelope.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.payeeDisplayAlias.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(result).toEqual({ mode: "all_data", transactionsDeleted: 2, envelopesDeleted: 5 })
  })
})
