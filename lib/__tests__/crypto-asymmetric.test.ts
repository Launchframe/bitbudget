// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, it, expect } from "vitest"
import {
  generateKeyPairFromSeed,
  deriveAsymmetricSeed,
  encryptFieldAsymmetric,
  decryptFieldAsymmetric,
  publicKeyToHex,
  hexToPublicKey,
  looksLikeAsymmetricCiphertext,
} from "../crypto"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

describe("asymmetric encryption", () => {
  it("derives a deterministic seed from passphrase + salt", async () => {
    const salt = "test-salt-value"
    const seed1 = await deriveAsymmetricSeed("my-passphrase", salt)
    const seed2 = await deriveAsymmetricSeed("my-passphrase", salt)
    expect(seed1).toEqual(seed2)
    expect(seed1.length).toBe(32)
  })

  it("generates different seeds for different passphrases", async () => {
    const salt = "test-salt"
    const seed1 = await deriveAsymmetricSeed("passphrase-a", salt)
    const seed2 = await deriveAsymmetricSeed("passphrase-b", salt)
    expect(Buffer.from(seed1).toString("hex")).not.toBe(
      Buffer.from(seed2).toString("hex")
    )
  })

  it("generates a valid key pair from seed", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    expect(publicKey.length).toBe(32)
    expect(secretKey.length).toBe(32)
  })

  it("encrypts and decrypts a field with key pair", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const plaintext = "Trader Joe's"
    const encrypted = encryptFieldAsymmetric(plaintext, publicKey)
    expect(encrypted).not.toBe(plaintext)
    const decrypted = decryptFieldAsymmetric(encrypted, secretKey)
    expect(decrypted).toBe(plaintext)
  })

  it("handles empty string", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const encrypted = encryptFieldAsymmetric("", publicKey)
    const decrypted = decryptFieldAsymmetric(encrypted, secretKey)
    expect(decrypted).toBe("")
  })

  it("handles unicode content", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const plaintext = "Café résumé 日本語 🚀"
    const encrypted = encryptFieldAsymmetric(plaintext, publicKey)
    const decrypted = decryptFieldAsymmetric(encrypted, secretKey)
    expect(decrypted).toBe(plaintext)
  })

  it("produces different ciphertext each time (random nonce)", async () => {
    const seed = await deriveAsymmetricSeed("test-pass", "test-salt")
    const { publicKey } = generateKeyPairFromSeed(seed)
    const a = encryptFieldAsymmetric("hello", publicKey)
    const b = encryptFieldAsymmetric("hello", publicKey)
    expect(a).not.toBe(b)
  })

  it("fails to decrypt with wrong key", async () => {
    const seed1 = await deriveAsymmetricSeed("pass-1", "salt")
    const seed2 = await deriveAsymmetricSeed("pass-2", "salt")
    const { publicKey } = generateKeyPairFromSeed(seed1)
    const { secretKey: wrongKey } = generateKeyPairFromSeed(seed2)
    const encrypted = encryptFieldAsymmetric("secret data", publicKey)
    expect(() => decryptFieldAsymmetric(encrypted, wrongKey)).toThrow()
  })

  it("looksLikeAsymmetricCiphertext matches sealed-box base64", async () => {
    const seed = await deriveAsymmetricSeed("test", "salt")
    const { publicKey } = generateKeyPairFromSeed(seed)
    const encrypted = encryptFieldAsymmetric("x", publicKey)
    expect(looksLikeAsymmetricCiphertext(encrypted)).toBe(true)
    expect(looksLikeAsymmetricCiphertext("Trader Joe's")).toBe(false)
    expect(looksLikeAsymmetricCiphertext("")).toBe(false)
  })

  it("looksLikeAsymmetricCiphertext rejects non-base64-multiple-of-4 and short decoded payloads", () => {
    // Long base64-ish ASCII but invalid length → false (avoids some false positives).
    const almost = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
    expect(almost.length % 4).toBe(1)
    expect(looksLikeAsymmetricCiphertext(almost)).toBe(false)
    // Valid charset + length % 4 but decodes to fewer than sealed-box bytes.
    const shortB64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eg==" // 64 chars → 48 bytes
    expect(shortB64.length % 4).toBe(0)
    expect(looksLikeAsymmetricCiphertext(shortB64)).toBe(false)
  })

  it("round-trips public key through hex encoding", async () => {
    const seed = await deriveAsymmetricSeed("test", "salt")
    const { publicKey } = generateKeyPairFromSeed(seed)
    const hex = publicKeyToHex(publicKey)
    expect(hex.length).toBe(64)
    const restored = hexToPublicKey(hex)
    expect(restored).toEqual(publicKey)
  })
})
