import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  decryptFieldAsymmetric,
  generateKeyPairFromSeed,
  publicKeyToHex,
} from "../crypto"
import {
  issuePublicKeyPossessionChallenge,
  verifyPublicKeyPossession,
} from "../public-key-possession"

describe("public-key possession", () => {
  const prevSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-at-least-32-chars!!"
  })

  afterEach(() => {
    process.env.AUTH_SECRET = prevSecret
  })

  it("issues a sealed challenge that only the key holder can prove", () => {
    const seed = new Uint8Array(32).fill(9)
    const pair = generateKeyPairFromSeed(seed)
    const hex = publicKeyToHex(pair.publicKey)

    const { challengeToken, sealedChallenge } = issuePublicKeyPossessionChallenge(hex)
    const challenge = decryptFieldAsymmetric(sealedChallenge, pair.secretKey)

    expect(
      verifyPublicKeyPossession({
        publicKeyHex: hex,
        challengeToken,
        challenge,
      }),
    ).toBe(true)
  })

  it("rejects a challenge decrypted for a different key", () => {
    const a = generateKeyPairFromSeed(new Uint8Array(32).fill(1))
    const b = generateKeyPairFromSeed(new Uint8Array(32).fill(2))
    const hexA = publicKeyToHex(a.publicKey)
    const hexB = publicKeyToHex(b.publicKey)

    const { challengeToken, sealedChallenge } = issuePublicKeyPossessionChallenge(hexA)
    const challenge = decryptFieldAsymmetric(sealedChallenge, a.secretKey)

    expect(
      verifyPublicKeyPossession({
        publicKeyHex: hexB,
        challengeToken,
        challenge,
      }),
    ).toBe(false)
  })

  it("rejects a wrong plaintext challenge", () => {
    const pair = generateKeyPairFromSeed(new Uint8Array(32).fill(3))
    const hex = publicKeyToHex(pair.publicKey)
    const { challengeToken } = issuePublicKeyPossessionChallenge(hex)

    expect(
      verifyPublicKeyPossession({
        publicKeyHex: hex,
        challengeToken,
        challenge: "00".repeat(32),
      }),
    ).toBe(false)
  })

  it("rejects a tampered challenge token", () => {
    const pair = generateKeyPairFromSeed(new Uint8Array(32).fill(4))
    const hex = publicKeyToHex(pair.publicKey)
    const { challengeToken, sealedChallenge } = issuePublicKeyPossessionChallenge(hex)
    const challenge = decryptFieldAsymmetric(sealedChallenge, pair.secretKey)
    const tampered = Buffer.from(
      JSON.stringify({
        publicKeyHex: hex,
        challenge,
        exp: Date.now() + 60_000,
        mac: "ab".repeat(32),
      }),
      "utf8",
    ).toString("base64url")

    expect(
      verifyPublicKeyPossession({
        publicKeyHex: hex,
        challengeToken: tampered,
        challenge,
      }),
    ).toBe(false)
    expect(challengeToken.length).toBeGreaterThan(0)
  })
})
