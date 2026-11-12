import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { encryptionKey, walletConfig } from "@/lib/wallet/server/config"
import { unwrapCosignerShare, wrapCosignerShare } from "@/lib/wallet/server/encryption"

const binding = { userId: "user-1", walletId: "wallet-1", network: "regtest", publicPackageHash: "ab".repeat(32) }

beforeEach(() => {
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
  vi.stubEnv("WALLET_WEBAUTHN_RP_ID", "wallet.example.com")
  vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", "https://wallet.example.com")
})
afterEach(() => vi.unstubAllEnvs())

describe("wallet server-only configuration", () => {
  it("accepts an exact RP and explicit origin allowlist", () => {
    expect(walletConfig()).toEqual({ rpId: "wallet.example.com", origins: ["https://wallet.example.com"] })
    expect(encryptionKey()).toHaveLength(32)
  })

  it.each([undefined, "", "not-a-key", "00".repeat(32), Buffer.alloc(32).toString("base64"), randomBytes(31).toString("base64"), randomBytes(33).toString("base64")])("fails closed for an invalid encryption key %s", value => {
    vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", value)
    expect(encryptionKey).toThrow("creation-unavailable")
  })

  it.each([undefined, "https://evil.example.com", "https://wallet.example.com/", "https://wallet.example.com/path", "http://wallet.example.com", "https://wallet.example.com.evil.test", "https://user@wallet.example.com", "*"])("rejects unsafe origins %s", origin => {
    vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", origin)
    expect(walletConfig).toThrow("creation-unavailable")
  })

  it("permits localhost HTTP only outside production", () => {
    vi.stubEnv("WALLET_WEBAUTHN_RP_ID", "localhost")
    vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", "http://localhost:3001")
    expect(walletConfig().origins).toEqual(["http://localhost:3001"])
    vi.stubEnv("NODE_ENV", "production")
    expect(walletConfig).toThrow("creation-unavailable")
  })
})

describe("co-signer B envelope", () => {
  it("uses randomized authenticated encryption without modifying the caller buffer", () => {
    const share = randomBytes(128)
    const saved = Buffer.from(share)
    const envelope = wrapCosignerShare(share, binding)
    expect(envelope).not.toEqual(wrapCosignerShare(share, binding))
    expect(envelope.includes(share)).toBe(false)
    expect(unwrapCosignerShare(envelope, binding)).toEqual(share)
    expect(share).toEqual(saved)
  })

  it.each([
    { userId: "wrong-owner" }, { walletId: "wrong-wallet" }, { network: "signet" }, { publicPackageHash: "cd".repeat(32) },
  ])("rejects changed AAD %j", mutation => {
    const envelope = wrapCosignerShare(randomBytes(100), binding)
    expect(() => unwrapCosignerShare(envelope, { ...binding, ...mutation })).toThrow("cosigner-unavailable")
  })

  it("rejects wrong key, tampered ciphertext, version, IV, tag and truncation", () => {
    const envelope = wrapCosignerShare(randomBytes(100), binding)
    for (const index of [0, 1, 13, 29, envelope.length - 1]) {
      const corrupted = Buffer.from(envelope)
      corrupted[index] ^= 1
      expect(() => unwrapCosignerShare(corrupted, binding)).toThrow("cosigner-unavailable")
    }
    expect(() => unwrapCosignerShare(envelope.subarray(0, 29), binding)).toThrow("cosigner-unavailable")
    vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
    expect(() => unwrapCosignerShare(envelope, binding)).toThrow("cosigner-unavailable")
  })

  it("never wraps a share for mainnet", () => {
    expect(() => wrapCosignerShare(randomBytes(100), { ...binding, network: "mainnet" })).toThrow("invalid-binding")
  })
})
