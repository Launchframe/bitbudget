// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, it, expect } from "vitest"
import {
  decryptFieldAsymmetric,
  deriveAsymmetricSeed,
  generateKeyPairFromSeed,
  publicKeyToHex,
} from "../crypto"
import { encryptFieldForUser } from "../server-encrypt"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

describe("encryptFieldForUser", () => {
  it("returns null when publicKeyHex is null", () => {
    expect(encryptFieldForUser("hello", null)).toBeNull()
  })

  it("returns null when publicKeyHex is undefined", () => {
    expect(encryptFieldForUser("hello", undefined)).toBeNull()
  })

  it("returns null when plaintext is null", () => {
    expect(encryptFieldForUser(null, "aabbcc")).toBeNull()
  })

  it("returns null when plaintext is undefined", () => {
    expect(encryptFieldForUser(undefined, "aabbcc")).toBeNull()
  })

  it("encrypts and is decryptable by the user's secret key", async () => {
    const seed = await deriveAsymmetricSeed("pass", "salt")
    const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
    const hex = publicKeyToHex(publicKey)
    const encrypted = encryptFieldForUser("Starbucks", hex)
    expect(encrypted).not.toBeNull()
    expect(encrypted).not.toBe("Starbucks")
    const decrypted = decryptFieldAsymmetric(encrypted!, secretKey)
    expect(decrypted).toBe("Starbucks")
  })
})
