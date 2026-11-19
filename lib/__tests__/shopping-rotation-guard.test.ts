// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const shoppingMemberFindFirst = vi.fn()
const shoppingMemberFindMany = vi.fn()
const shoppingTransaction = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    shoppingMember: {
      findFirst: (...args: unknown[]) => shoppingMemberFindFirst(...args),
      findMany: (...args: unknown[]) => shoppingMemberFindMany(...args),
    },
    $transaction: (...args: unknown[]) => shoppingTransaction(...args),
  },
}))

import {
  assertReencryptedShoppingCiphertext,
  assertWrapsCoverMembers,
  rotateGroupKeys,
} from "@/lib/shopping-server"

const CIPHERTEXT = "sg1:0123456789abcdef01234567:abcd"
const WRAP = "k".repeat(40)

describe("shopping key rotation guards", () => {
  beforeEach(() => {
    shoppingMemberFindFirst.mockReset()
    shoppingMemberFindMany.mockReset()
    shoppingTransaction.mockReset()
  })

  it("requires one wrap per active member and a sealed key", () => {
    expect(() => assertWrapsCoverMembers(
      [
        { memberId: "a", wrappedKey: WRAP },
        { memberId: "a", wrappedKey: WRAP },
      ],
      ["a", "b"],
    )).toThrow(/every remaining member/)
    expect(() => assertWrapsCoverMembers(
      [{ memberId: "a", wrappedKey: WRAP }],
      ["a", "b"],
    )).toThrow(/every remaining member/)
    expect(() => assertWrapsCoverMembers(
      [
        { memberId: "a", wrappedKey: WRAP },
        { memberId: "b", wrappedKey: WRAP },
      ],
      ["a", "c"],
    )).toThrow(/every remaining member/)
    expect(() => assertWrapsCoverMembers(
      [{ memberId: "a", wrappedKey: "short" }],
      ["a"],
    )).toThrow(/Missing wrapped group key/)
    expect(() => assertWrapsCoverMembers(
      [{ memberId: "a", wrappedKey: WRAP }],
      ["a"],
    )).not.toThrow()
  })

  it("rejects plaintext, a missing id, a bad revision, and an oversized payload", () => {
    expect(() => assertReencryptedShoppingCiphertext({
      lists: [{ id: "l1", encryptedPayload: "milk", revision: 1 }],
    })).toThrow(/must be encrypted/)
    expect(() => assertReencryptedShoppingCiphertext({
      requests: [{ encryptedPayload: CIPHERTEXT, revision: 1 }],
    })).toThrow(/Invalid revision/)
    expect(() => assertReencryptedShoppingCiphertext({
      receipts: [{ id: "r1", encryptedPayload: CIPHERTEXT, revision: 0 }],
    })).toThrow(/Invalid revision/)
    expect(() => assertReencryptedShoppingCiphertext({
      lists: "nope" as unknown as [],
    })).toThrow(/Invalid revision/)
    expect(() => assertReencryptedShoppingCiphertext({
      lists: ["milk"] as never,
    })).toThrow(/Invalid revision/)
    const huge = `sg1:0123456789abcdef01234567:${"ab".repeat(40_000)}`
    expect(() => assertReencryptedShoppingCiphertext({
      lists: [{ id: "l1", encryptedPayload: huge, revision: 1 }],
    })).toThrow(/too large/)
    expect(() => assertReencryptedShoppingCiphertext({
      lists: [{ id: "l1", encryptedPayload: CIPHERTEXT, revision: 2 }],
    })).not.toThrow()
    expect(() => assertReencryptedShoppingCiphertext({})).not.toThrow()
  })

  it("does not open a transaction when rotated list text is plaintext", async () => {
    shoppingMemberFindFirst.mockResolvedValue({
      id: "owner",
      role: "owner",
      status: "active",
      group: { id: "g1", keyVersion: 1, lifecycle: "active", membershipRevision: 3 },
    })
    shoppingMemberFindMany.mockResolvedValue([
      { id: "m1", pinnedKeyFingerprint: "abcd-ef01-2345-6789" },
    ])
    await expect(rotateGroupKeys({
      groupId: "g1",
      userId: "u1",
      nextKeyVersion: 2,
      encryptedMetadata: CIPHERTEXT,
      wraps: [{ memberId: "m1", fingerprint: "abcd-ef01-2345-6789", wrappedKey: WRAP }],
      reencrypted: { lists: [{ id: "l1", encryptedPayload: "milk and eggs", revision: 1 }] },
    })).rejects.toMatchObject({ status: 400, message: "List must be encrypted" })
    expect(shoppingTransaction).not.toHaveBeenCalled()
  })
})
