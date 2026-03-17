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

  it("round-trips public key through hex encoding", async () => {
    const seed = await deriveAsymmetricSeed("test", "salt")
    const { publicKey } = generateKeyPairFromSeed(seed)
    const hex = publicKeyToHex(publicKey)
    expect(hex.length).toBe(64)
    const restored = hexToPublicKey(hex)
    expect(restored).toEqual(publicKey)
  })
})
