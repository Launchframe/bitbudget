import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ENCRYPTION_RESET_CONFIRM,
  parseEncryptionResetMode,
  resetUserEncryption,
} from "../encryption-reset-server"

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    transaction: { deleteMany: vi.fn() },
    pendingTransaction: { deleteMany: vi.fn(), updateMany: vi.fn() },
    transactionShortcut: { deleteMany: vi.fn() },
    envelope: { deleteMany: vi.fn() },
    user: { update: vi.fn() },
  },
}))

vi.mock("@/lib/shopping-posting-server", () => ({
  suppressAllShoppingPostingsForUser: vi.fn(async () => {}),
}))

import { prisma } from "@/lib/db"
import { suppressAllShoppingPostingsForUser } from "@/lib/shopping-posting-server"

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

  it("clears keys and transactions for encrypted_data without deleting envelopes", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        transaction: { deleteMany: vi.fn(async () => ({ count: 3 })) },
        pendingTransaction: { deleteMany: vi.fn(async () => ({ count: 1 })), updateMany: vi.fn() },
        transactionShortcut: { deleteMany: vi.fn() },
        envelope: { deleteMany: vi.fn() },
        user: { update: vi.fn(async () => ({})) },
      }
      return fn(tx as never)
    })

    const result = await resetUserEncryption({ userId: "u1", mode: "encrypted_data" })
    expect(suppressAllShoppingPostingsForUser).toHaveBeenCalledWith("u1")
    expect(result).toEqual({ mode: "encrypted_data", transactionsDeleted: 3, envelopesDeleted: 0 })
  })

  it("also deletes envelopes for all_data", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        transaction: { deleteMany: vi.fn(async () => ({ count: 2 })) },
        pendingTransaction: {
          deleteMany: vi.fn(async () => ({ count: 0 })),
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
        transactionShortcut: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        envelope: { deleteMany: vi.fn(async () => ({ count: 5 })) },
        user: { update: vi.fn(async () => ({})) },
      }
      return fn(tx as never)
    })

    const result = await resetUserEncryption({ userId: "u1", mode: "all_data" })
    expect(result).toEqual({ mode: "all_data", transactionsDeleted: 2, envelopesDeleted: 5 })
  })
})
