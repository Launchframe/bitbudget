import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ENCRYPTION_RESET_CONFIRM,
  parseEncryptionResetMode,
} from "../encryption-reset"
import {
  ENCRYPTION_RESET_MAX_SESSION_AGE_SEC,
  encryptionResetRequiresReauth,
  resetUserEncryption,
} from "../encryption-reset-server"

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    transaction: { deleteMany: vi.fn() },
    pendingTransaction: { deleteMany: vi.fn(), updateMany: vi.fn() },
    transactionShortcut: { deleteMany: vi.fn() },
    recurringTransaction: { deleteMany: vi.fn() },
    pendingStatementBatch: { deleteMany: vi.fn() },
    envelopeFundingBatch: { deleteMany: vi.fn() },
    shoppingMemberKey: { deleteMany: vi.fn() },
    payeeDisplayAlias: { deleteMany: vi.fn() },
    recurringFundingRule: { deleteMany: vi.fn() },
    savingsGoal: { deleteMany: vi.fn() },
    tag: { deleteMany: vi.fn() },
    userAchievement: { deleteMany: vi.fn() },
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
    envelopeFundingBatch: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    shoppingMemberKey: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    payeeDisplayAlias: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    recurringFundingRule: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    savingsGoal: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tag: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    userAchievement: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    envelope: { deleteMany: vi.fn(async () => ({ count: overrides?.envelopeCount ?? 0 })) },
    user: { update: vi.fn(async () => ({})) },
  }
}

describe("encryptionResetRequiresReauth", () => {
  it("requires reauth when iat is missing or stale", () => {
    const now = 1_700_000_000
    expect(encryptionResetRequiresReauth(null, now)).toBe(true)
    expect(encryptionResetRequiresReauth(undefined, now)).toBe(true)
    expect(encryptionResetRequiresReauth(now - ENCRYPTION_RESET_MAX_SESSION_AGE_SEC - 1, now)).toBe(true)
    expect(encryptionResetRequiresReauth(now - 60, now)).toBe(false)
  })
})

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

  it("clears keys, funding batches, and shopping wraps without deleting envelopes", async () => {
    const tx = mockTx({ txnCount: 3 })
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const result = await resetUserEncryption({ userId: "u1", mode: "encrypted_data" })
    expect(suppressAllShoppingPostingsForUser).toHaveBeenCalledWith("u1")
    expect(tx.envelopeFundingBatch.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.shoppingMemberKey.deleteMany).toHaveBeenCalled()
    expect(tx.envelope.deleteMany).not.toHaveBeenCalled()
    expect(tx.recurringFundingRule.deleteMany).not.toHaveBeenCalled()
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { encryptedPrivacyKey: null, privacyKeySalt: null, publicKey: null },
    })
    expect(result).toEqual({ mode: "encrypted_data", transactionsDeleted: 3, envelopesDeleted: 0 })
  })

  it("also deletes envelopes, goals, tags, and funding rules for all_data", async () => {
    const tx = mockTx({ txnCount: 2, envelopeCount: 5 })
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const result = await resetUserEncryption({ userId: "u1", mode: "all_data" })
    expect(tx.pendingTransaction.updateMany).not.toHaveBeenCalled()
    expect(tx.envelope.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.payeeDisplayAlias.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.recurringFundingRule.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.savingsGoal.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.tag.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(tx.userAchievement.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(result).toEqual({ mode: "all_data", transactionsDeleted: 2, envelopesDeleted: 5 })
  })
})
