// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import { generateKeyPairFromSeed, publicKeyToHex } from "../crypto"
import {
  decryptShoppingPayload,
  encryptShoppingPayload,
  generateGroupContentKey,
  isShoppingCiphertext,
  formatShoppingFingerprintDisplay,
  isShoppingKeyFingerprint,
  publicKeyFingerprint,
  unwrapGroupContentKey,
  wrapGroupContentKey,
} from "../shopping-crypto"
import { SHOPPING_PAYLOAD_SCHEMA_VERSION, type ShoppingAad } from "../shopping-types"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

function aad(over: Partial<ShoppingAad> = {}): ShoppingAad {
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    groupId: "grp_1",
    objectId: "obj_1",
    keyVersion: 1,
    revision: 1,
    recordType: "request",
    ...over,
  }
}

describe("shopping-crypto", () => {
  it("round-trips JSON for independent seeds", async () => {
    const key = generateGroupContentKey()
    const payload = JSON.stringify({ schemaVersion: 1, description: "Milk" })
    const ct = await encryptShoppingPayload(payload, key, aad())
    expect(isShoppingCiphertext(ct)).toBe(true)
    expect(await decryptShoppingPayload(ct, key, aad())).toBe(payload)
  })

  it("fails closed on plaintext and wrong context", async () => {
    const key = generateGroupContentKey()
    await expect(decryptShoppingPayload("Milk", key, aad())).rejects.toThrow(/not encrypted/)
    const ct = await encryptShoppingPayload(JSON.stringify({ schemaVersion: 1 }), key, aad())
    await expect(decryptShoppingPayload(ct, key, aad({ objectId: "other" }))).rejects.toThrow()
    await expect(decryptShoppingPayload(ct, generateGroupContentKey(), aad())).rejects.toThrow()
  })

  it("wraps the group key to a member public key", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const pair = generateKeyPairFromSeed(seed)
    const groupKey = generateGroupContentKey()
    const wrapped = wrapGroupContentKey(groupKey, pair.publicKey)
    expect(wrapped).not.toContain(Buffer.from(groupKey).toString("hex"))
    expect(unwrapGroupContentKey(wrapped, pair.secretKey)).toEqual(groupKey)
    const other = generateKeyPairFromSeed(crypto.getRandomValues(new Uint8Array(32)))
    expect(() => unwrapGroupContentKey(wrapped, other.secretKey)).toThrow()
  })

  it("fingerprints public keys as six hex digits", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const pair = generateKeyPairFromSeed(seed)
    const fp = await publicKeyFingerprint(publicKeyToHex(pair.publicKey))
    expect(fp).toMatch(/^[0-9a-f]{6}$/)
    expect(isShoppingKeyFingerprint(fp)).toBe(true)
    expect(isShoppingKeyFingerprint("abcd-ef01-2345-6789")).toBe(true)
    expect(formatShoppingFingerprintDisplay("abcd-ef01-2345-6789")).toBe("abcdef")
    expect(formatShoppingFingerprintDisplay(fp)).toBe(fp)
  })
})
