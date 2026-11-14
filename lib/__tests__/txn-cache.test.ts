// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import {
  apiRowToCachedLocked,
  apiRowToCachedPlaintext,
  cachedToClientTransaction,
  decryptBatch,
  decryptSingleCachedRow,
  ENCRYPTED_DISPLAY,
  maxUpdatedAtIso,
  mergeLastSyncIso,
  mergeTransactionBatch,
  shouldHydrateIdbIntoState,
  type ApiTransactionRow,
} from "../txn-cache"
import {
  deriveAsymmetricSeed,
  encryptFieldAsymmetric,
  generateKeyPairFromSeed,
} from "../crypto"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

function baseRow(overrides: Partial<ApiTransactionRow> = {}): ApiTransactionRow {
  return {
    id: "t1",
    date: "2025-06-01",
    payee: "Coffee Shop",
    amount: 4.5,
    type: "expense",
    envelopeId: "env1",
    tags: ["food"],
    notes: null,
    satsAmount: null,
    recurringId: null,
    updatedAt: "2025-06-01T15:00:00.000Z",
    ...overrides,
  }
}

describe("txn-cache", () => {
  it("apiRowToCachedLocked masks payee and notes", () => {
    const c = apiRowToCachedLocked(
      baseRow({ payee: "cipher", notes: "n_cipher" }),
    )
    expect(c.isDecrypted).toBe(false)
    expect(c.payee).toBe(ENCRYPTED_DISPLAY)
    expect(c.notes).toBe(ENCRYPTED_DISPLAY)
    expect(c.serverPayee).toBe("cipher")
    expect(c.serverNotes).toBe("n_cipher")
  })

  it("apiRowToCachedPlaintext passes through fields", () => {
    const c = apiRowToCachedPlaintext(baseRow())
    expect(c.isDecrypted).toBe(true)
    expect(c.payee).toBe("Coffee Shop")
    expect(c.serverPayee).toBe("Coffee Shop")
  })

  it("cachedToClientTransaction omits server-only fields", () => {
    const c = apiRowToCachedPlaintext(baseRow())
    const t = cachedToClientTransaction(c)
    expect("serverPayee" in t).toBe(false)
    expect("serverNotes" in t).toBe(false)
  })

  it("decryptSingleCachedRow keeps legacy plaintext payee when decrypt is not applicable", async () => {
    const seed = await deriveAsymmetricSeed("p", "s")
    const { secretKey } = generateKeyPairFromSeed(seed)
    const row = baseRow({ payee: "Plain old payee", notes: null })
    const out = decryptSingleCachedRow(row, secretKey)
    expect(out.isDecrypted).toBe(true)
    expect(out.payee).toBe("Plain old payee")
  })

  it("decryptSingleCachedRow masks ciphertext on wrong key", async () => {
    const seed1 = await deriveAsymmetricSeed("a", "s")
    const seed2 = await deriveAsymmetricSeed("b", "s")
    const { publicKey } = generateKeyPairFromSeed(seed1)
    const { secretKey: wrongKey } = generateKeyPairFromSeed(seed2)
    const enc = encryptFieldAsymmetric("Secret", publicKey)
    const out = decryptSingleCachedRow(baseRow({ payee: enc }), wrongKey)
    expect(out.isDecrypted).toBe(false)
    expect(out.payee).toBe(ENCRYPTED_DISPLAY)
  })

  it("decryptBatch restores cleartext", async () => {
    const seed = await deriveAsymmetricSeed("p", "s")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const payeeEnc = encryptFieldAsymmetric("Trader Joe's", publicKey)
    const notesEnc = encryptFieldAsymmetric("weekly", publicKey)
    const rows = [
      baseRow({ id: "a", payee: payeeEnc, notes: notesEnc }),
    ]
    const out = await decryptBatch(rows, secretKey, 10)
    expect(out).toHaveLength(1)
    expect(out[0]!.isDecrypted).toBe(true)
    expect(out[0]!.payee).toBe("Trader Joe's")
    expect(out[0]!.notes).toBe("weekly")
  })

  it("maxUpdatedAtIso picks latest", () => {
    const a = apiRowToCachedPlaintext(baseRow({ id: "1", updatedAt: "2025-01-01T00:00:00.000Z" }))
    const b = apiRowToCachedPlaintext(baseRow({ id: "2", updatedAt: "2026-01-01T00:00:00.000Z" }))
    expect(maxUpdatedAtIso([a, b])).toBe("2026-01-01T00:00:00.000Z")
  })

  it("mergeLastSyncIso advances cursor and preserves higher watermark", () => {
    expect(mergeLastSyncIso(null, "2025-01-01T00:00:00.000Z")).toBe("2025-01-01T00:00:00.000Z")
    expect(mergeLastSyncIso("2026-01-01T00:00:00.000Z", null)).toBe("2026-01-01T00:00:00.000Z")
    expect(
      mergeLastSyncIso("2025-06-01T00:00:00.000Z", "2025-12-01T00:00:00.000Z"),
    ).toBe("2025-12-01T00:00:00.000Z")
    expect(
      mergeLastSyncIso("2025-12-01T00:00:00.000Z", "2025-06-01T00:00:00.000Z"),
    ).toBe("2025-12-01T00:00:00.000Z")
  })

  it("mergeTransactionBatch overwrites by id and sorts by date desc", () => {
    const older = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "a", date: "2024-01-01", amount: 1 })),
    )
    const newer = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "b", date: "2025-06-01", amount: 2 })),
    )
    const updatedA = apiRowToCachedPlaintext(baseRow({ id: "a", date: "2024-01-01", amount: 99 }))
    const merged = mergeTransactionBatch([older, newer], [updatedA])
    expect(merged.map((t) => t.id)).toEqual(["b", "a"])
    expect(merged.find((t) => t.id === "a")!.amount).toBe(99)
  })

  it("mergeTransactionBatch skips full sort when only in-place updates preserve order", () => {
    const t1 = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "a", date: "2025-06-01", amount: 1 })),
    )
    const t2 = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "b", date: "2024-01-01", amount: 2 })),
    )
    const upd = apiRowToCachedPlaintext(baseRow({ id: "a", date: "2025-06-01", amount: 99 }))
    const merged = mergeTransactionBatch([t1, t2], [upd])
    expect(merged.map((x) => x.id)).toEqual(["a", "b"])
    expect(merged[0]!.amount).toBe(99)
  })

  it("mergeTransactionBatch appends older-only batch in desc order without resorting whole list", () => {
    const head = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "h", date: "2025-06-01", amount: 1 })),
    )
    const tail = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "t", date: "2024-01-01", amount: 2 })),
    )
    const n1 = apiRowToCachedPlaintext(baseRow({ id: "n1", date: "2023-12-01", amount: 3 }))
    const n2 = apiRowToCachedPlaintext(baseRow({ id: "n2", date: "2023-06-01", amount: 4 }))
    const merged = mergeTransactionBatch([head, tail], [n1, n2])
    expect(merged.map((x) => x.id)).toEqual(["h", "t", "n1", "n2"])
  })

  it("mergeTransactionBatch sorts when new rows are older than tail but batch order is wrong", () => {
    const head = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "h", date: "2025-06-01", amount: 1 })),
    )
    const tail = cachedToClientTransaction(
      apiRowToCachedPlaintext(baseRow({ id: "t", date: "2024-01-01", amount: 2 })),
    )
    const olderFirst = apiRowToCachedPlaintext(baseRow({ id: "n1", date: "2023-06-01", amount: 3 }))
    const newerSecond = apiRowToCachedPlaintext(baseRow({ id: "n2", date: "2023-12-01", amount: 4 }))
    const merged = mergeTransactionBatch([head, tail], [olderFirst, newerSecond])
    expect(merged.map((x) => x.id)).toEqual(["h", "t", "n2", "n1"])
  })
})

describe("shouldHydrateIdbIntoState", () => {
  it("skips IndexedDB cleartext while the session has no privacy key", () => {
    expect(
      shouldHydrateIdbIntoState({
        idbAvailable: true,
        alreadyHydrated: false,
        lockedWithoutKey: true,
      }),
    ).toBe(false)
    expect(
      shouldHydrateIdbIntoState({
        idbAvailable: true,
        alreadyHydrated: false,
        lockedWithoutKey: false,
      }),
    ).toBe(true)
    expect(
      shouldHydrateIdbIntoState({
        idbAvailable: true,
        alreadyHydrated: true,
        lockedWithoutKey: false,
      }),
    ).toBe(false)
  })
})
