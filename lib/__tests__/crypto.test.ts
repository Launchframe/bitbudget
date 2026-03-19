// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, it, expect } from "vitest"
import {
  uint8ToHex,
  hexToUint8,
  generateSalt,
  generatePrivacyKey,
  deriveKeyFromPin,
  encryptPrivacyKey,
  decryptPrivacyKey,
  encryptField,
  decryptField,
} from "../crypto"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

describe("uint8ToHex / hexToUint8", () => {
  it("round-trips bytes to hex and back", () => {
    const bytes = new Uint8Array([0, 15, 255, 128, 32])
    expect(hexToUint8(uint8ToHex(bytes))).toEqual(bytes)
  })

  it("produces lowercase hex of even length", () => {
    const bytes = new Uint8Array([0xab, 0xcd])
    expect(uint8ToHex(bytes)).toBe("abcd")
    expect(uint8ToHex(bytes).length % 2).toBe(0)
  })

  it("handles empty array", () => {
    const bytes = new Uint8Array(0)
    expect(uint8ToHex(bytes)).toBe("")
    expect(hexToUint8("")).toEqual(new Uint8Array(0))
  })
})

describe("generateSalt", () => {
  it("returns 16 bytes", () => {
    const salt = generateSalt()
    expect(salt.length).toBe(16)
  })

  it("returns different values each call", () => {
    const a = generateSalt()
    const b = generateSalt()
    expect(uint8ToHex(a)).not.toBe(uint8ToHex(b))
  })
})

describe("generatePrivacyKey", () => {
  it("returns 32 bytes", () => {
    const key = generatePrivacyKey()
    expect(key.length).toBe(32)
  })

  it("returns different values each call", () => {
    const a = generatePrivacyKey()
    const b = generatePrivacyKey()
    expect(uint8ToHex(a)).not.toBe(uint8ToHex(b))
  })
})

describe("deriveKeyFromPin", () => {
  it("derives same key for same pin and salt", async () => {
    const salt = new Uint8Array(16).fill(1)
    const key1 = await deriveKeyFromPin("mypin123", salt)
    const key2 = await deriveKeyFromPin("mypin123", salt)
    expect(key1).toEqual(key2)
  })

  it("derives different keys for different pins", async () => {
    const salt = new Uint8Array(16).fill(1)
    const key1 = await deriveKeyFromPin("pin1", salt)
    const key2 = await deriveKeyFromPin("pin2", salt)
    const data = await encryptPrivacyKey(generatePrivacyKey(), key1)
    await expect(decryptPrivacyKey(data, key2)).rejects.toThrow()
  })

  it("derives different keys for different salts", async () => {
    const salt1 = new Uint8Array(16).fill(1)
    const salt2 = new Uint8Array(16).fill(2)
    const key1 = await deriveKeyFromPin("samepin", salt1)
    const key2 = await deriveKeyFromPin("samepin", salt2)
    const data = await encryptPrivacyKey(generatePrivacyKey(), key1)
    await expect(decryptPrivacyKey(data, key2)).rejects.toThrow()
  })
})

describe("encryptPrivacyKey / decryptPrivacyKey", () => {
  it("round-trips a privacy key", async () => {
    const salt = new Uint8Array(16).fill(0)
    const wrappingKey = await deriveKeyFromPin("test-pin", salt)
    const privacyKey = new Uint8Array(32)
    privacyKey.set([1, 2, 3, 4, 5])
    const encrypted = await encryptPrivacyKey(privacyKey, wrappingKey)
    expect(encrypted).toHaveProperty("iv")
    expect(encrypted).toHaveProperty("ciphertext")
    expect(encrypted.iv.length).toBe(24)
    const decrypted = await decryptPrivacyKey(encrypted, wrappingKey)
    expect(decrypted).toEqual(privacyKey)
  })

  it("produces different ciphertext each time (random iv)", async () => {
    const salt = new Uint8Array(16).fill(0)
    const wrappingKey = await deriveKeyFromPin("pin", salt)
    const privacyKey = generatePrivacyKey()
    const a = await encryptPrivacyKey(privacyKey, wrappingKey)
    const b = await encryptPrivacyKey(privacyKey, wrappingKey)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it("fails to decrypt with wrong key", async () => {
    const salt = new Uint8Array(16).fill(0)
    const rightKey = await deriveKeyFromPin("right", salt)
    const wrongKey = await deriveKeyFromPin("wrong", salt)
    const privacyKey = generatePrivacyKey()
    const encrypted = await encryptPrivacyKey(privacyKey, rightKey)
    await expect(decryptPrivacyKey(encrypted, wrongKey)).rejects.toThrow()
  })
})

describe("encryptField / decryptField", () => {
  it("round-trips a plaintext field", async () => {
    const key = generatePrivacyKey()
    const plain = "Trader Joe's"
    const encrypted = await encryptField(plain, key)
    expect(encrypted).not.toBe(plain)
    expect(encrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]+$/)
    const decrypted = await decryptField(encrypted, key)
    expect(decrypted).toBe(plain)
  })

  it("returns empty string as-is when encrypting", async () => {
    const key = generatePrivacyKey()
    expect(await encryptField("", key)).toBe("")
  })

  it("returns non-matching format as-is when decrypting", async () => {
    const key = generatePrivacyKey()
    expect(await decryptField("not-encrypted", key)).toBe("not-encrypted")
    expect(await decryptField("", key)).toBe("")
  })

  it("handles unicode content", async () => {
    const key = generatePrivacyKey()
    const plain = "Café résumé 日本語 🚀"
    const encrypted = await encryptField(plain, key)
    const decrypted = await decryptField(encrypted, key)
    expect(decrypted).toBe(plain)
  })

  it("produces different ciphertext each time", async () => {
    const key = generatePrivacyKey()
    const a = await encryptField("same", key)
    const b = await encryptField("same", key)
    expect(a).not.toBe(b)
  })
})
