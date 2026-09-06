import { describe, expect, it } from "vitest"
import {
  MAX_SHARE_BYTES, parseDeviceShareEnvelope, parseShareCustodyContext, unwrapDeviceShare, wrapDeviceShare,
  type ShareCustodyContext,
} from "@/lib/wallet/client-custody"

const context: ShareCustodyContext = {
  accountId: "account-one", walletId: "wallet-one", participantId: "participant-one", role: "A",
  network: "signet", shareFormat: "frost-secp256k1-v1", groupPublicKeyHex: "02" + "ab".repeat(32),
  publicPackageHex: "1234567890abcdef", policy: { threshold: 2, participants: 3 },
  derivationContext: "public-derivation-context-v1",
}
const share = new Uint8Array([4, 19, 91, 28, 83, 72, 0, 255])
const prfOutput = new Uint8Array(32).fill(17)
const credentialId = "authenticator-credential-one"

function wrap() {
  return wrapDeviceShare({ share, context, credentialId, prfOutput })
}

describe("PRF device share custody", () => {
  it("wraps exactly the supplied bytes with fresh salt and IV and stores no operational key", async () => {
    const first = await wrap()
    const second = await wrap()
    expect(first.saltHex).toHaveLength(64)
    expect(first.ivHex).toHaveLength(24)
    expect(first.saltHex).not.toBe(second.saltHex)
    expect(first.ivHex).not.toBe(second.ivHex)
    expect(first.ciphertextHex).not.toBe(second.ciphertextHex)
    expect(Object.keys(first).sort()).toEqual([
      "version", "kind", "algorithm", "kdf", "context", "credentialId", "saltHex", "ivHex", "ciphertextHex",
    ].sort())
    const restored = await unwrapDeviceShare({ envelope: first, expectedContext: context, credentialId, prfOutput })
    expect(restored).toEqual(share)
    expect(prfOutput).toEqual(new Uint8Array(32).fill(17))
    expect(share).toEqual(new Uint8Array([4, 19, 91, 28, 83, 72, 0, 255]))
  })

  it("requires exactly 32 bytes of caller PRF output and role A", async () => {
    for (const length of [0, 16, 31, 33, 64]) {
      await expect(wrapDeviceShare({ share, context, credentialId, prfOutput: new Uint8Array(length) })).rejects.toThrow("PRF")
    }
    await expect(wrapDeviceShare({ share, context: { ...context, role: "C" }, credentialId, prfOutput })).rejects.toThrow("share A")
    for (const invalid of [new Uint8Array(0), new Uint8Array(MAX_SHARE_BYTES + 1)]) {
      await expect(wrapDeviceShare({ share: invalid, context, credentialId, prfOutput })).rejects.toThrow("share size")
    }
  })

  it("rejects another PRF or credential", async () => {
    const envelope = await wrap()
    await expect(unwrapDeviceShare({ envelope, expectedContext: context, credentialId, prfOutput: new Uint8Array(32).fill(18) })).rejects.toThrow("unlock")
    await expect(unwrapDeviceShare({ envelope, expectedContext: context, credentialId: "another-credential", prfOutput })).rejects.toThrow("Credential mismatch")
    await expect(unwrapDeviceShare({ envelope: { ...envelope, credentialId: "another-credential" }, expectedContext: context, credentialId: "another-credential", prfOutput })).rejects.toThrow("unlock")
  })

  it.each([
    ["accountId", "account-two"], ["walletId", "wallet-two"], ["participantId", "participant-two"],
    ["network", "mainnet"], ["shareFormat", "frost-other-v2"], ["groupPublicKeyHex", "03" + "cd".repeat(32)],
    ["publicPackageHex", "aabbccdd"], ["derivationContext", "different-derivation"],
  ])("authenticates %s even if the caller accepts the altered context", async (field, value) => {
    const envelope = await wrap()
    const changed = { ...context, [field]: value } as ShareCustodyContext
    await expect(unwrapDeviceShare({ envelope, expectedContext: changed, credentialId, prfOutput })).rejects.toThrow("context mismatch")
    await expect(unwrapDeviceShare({ envelope: { ...envelope, context: changed }, expectedContext: changed, credentialId, prfOutput })).rejects.toThrow("unlock")
  })

  it("rejects malformed envelopes and corrupted ciphertext", async () => {
    const envelope = await wrap()
    for (const patch of [
      { version: 2 }, { kdf: "none" }, { algorithm: "AES-CBC" }, { ivHex: "00" },
      { saltHex: "zz".repeat(32) }, { ciphertextHex: "f" }, { wrappingKey: {} },
    ]) expect(() => parseDeviceShareEnvelope({ ...envelope, ...patch })).toThrow()
    const corrupted = { ...envelope, ciphertextHex: (envelope.ciphertextHex.startsWith("00") ? "01" : "00") + envelope.ciphertextHex.slice(2) }
    await expect(unwrapDeviceShare({ envelope: corrupted, expectedContext: context, credentialId, prfOutput })).rejects.toThrow("unlock")
    expect(() => parseShareCustodyContext({ ...context, policy: { threshold: 1, participants: 3 } })).toThrow()
    expect(() => parseShareCustodyContext({ ...context, secret: "not-permitted" })).toThrow()
  })
})
