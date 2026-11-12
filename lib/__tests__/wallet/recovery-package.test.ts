import { describe, expect, it, vi } from "vitest"
import { createRecoveryPackage, decryptRecoveryPackage, parseRecoveryPackage, serializeRecoveryPackage, verifyRecoveryPackage } from "@/lib/wallet/recovery-package"
import type { ShareCustodyContext } from "@/lib/wallet/client-custody"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"
import { derivationContext } from "@/lib/wallet/derivation"

async function fixture() {
  const core = await loadWalletMpc()
  const ids = [1, 2, 3]
  const first = ids.map(id => new core.WasmDkgRound1(id))
  const broadcasts = first.map(state => state.broadcast())
  const second = first.map((state, index) => {
    const peers = ids.filter(id => id !== index + 1)
    return state.advance(peers[0], broadcasts[peers[0] - 1], peers[1], broadcasts[peers[1] - 1])
  })
  const messages = second.map((state, index) => new Map(ids.filter(id => id !== index + 1).map(id => [id, state.take_message(id)])))
  const shares = second.map((state, index) => {
    const peers = ids.filter(id => id !== index + 1)
    return state.finish(peers[0], messages[peers[0] - 1].get(index + 1)!, peers[1], messages[peers[1] - 1].get(index + 1)!)
  })
  for (const map of messages) for (const bytes of map.values()) bytes.fill(0)
  const publicPackage = shares[2].public_package()
  const context: ShareCustodyContext = {
    accountId: "test-account", walletId: "test-wallet", network: "regtest", shareFormat: "frost-secp256k1-tr-v3",
    groupPublicKeyHex: Buffer.from(shares[2].output_key()).toString("hex"),
    publicPackageHex: Buffer.from(publicPackage).toString("hex"),
    policy: { threshold: 2, participants: 3 }, derivationContext: "base-output-v1", participantId: "3", role: "C",
  }
  const secret = shares[2].export_secret_share()
  for (const share of shares) share.free()
  return { core, context, secret, publicPackage }
}

const password = "synthetic recovery password only"

describe("password-encrypted recovery C", () => {
  it("keeps the address derivation seed inside a versioned encrypted payload and wipes validator copies", async () => {
    const { context, secret } = await fixture()
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const bound = { ...context, derivationContext: derivationContext(seed) }
    const envelope = await createRecoveryPackage({ share: secret, context: bound, password, derivationSeed: seed })
    expect(envelope.version).toBe(2)
    expect(serializeRecoveryPackage(envelope)).not.toContain(Buffer.from(seed).toString("hex"))
    const decoded = await decryptRecoveryPackage({ envelope, expectedContext: bound, password })
    expect(decoded.share).toEqual(secret)
    expect(decoded.derivationSeed).toEqual(seed)
    decoded.share.fill(0); decoded.derivationSeed?.fill(0)
    let borrowed: Uint8Array | undefined
    await verifyRecoveryPackage({ envelope, expectedContext: bound, password, validateShare: async ({ derivationSeed }) => { borrowed = derivationSeed; return true } })
    expect(borrowed?.every(value => value === 0)).toBe(true)
    expect(() => parseRecoveryPackage({ ...envelope, version: 1 })).toThrow()
    await expect(createRecoveryPackage({ share: secret, context: bound, password })).rejects.toThrow()
    await expect(createRecoveryPackage({ share: secret, context: bound, password, derivationSeed: crypto.getRandomValues(new Uint8Array(32)) })).rejects.toThrow()
    seed.fill(0); secret.fill(0)
  })

  it("verifies an actual FROST share only after decryption and core validation, then wipes validator bytes", async () => {
    const { core, context, secret, publicPackage } = await fixture()
    const envelope = await createRecoveryPackage({ share: secret, context, password })
    const json = serializeRecoveryPackage(envelope)
    expect(json).not.toContain(password)
    expect(json).not.toContain(Buffer.from(secret).toString("hex"))
    expect(envelope.purpose).toBe("required-recovery-C")
    const decrypted = await decryptRecoveryPackage({ envelope: json, expectedContext: context, password })
    expect(decrypted.status).toBe("decrypted-unverified")
    expect(decrypted.share).toEqual(secret)
    decrypted.share.fill(0)
    let borrowed: Uint8Array | undefined
    const validator = vi.fn(async ({ share }: { share: Uint8Array }) => {
      borrowed = share
      const restored = core.WasmWalletShare.import_secret_share(3, share, publicPackage)
      try { return Buffer.from(restored.output_key()).toString("hex") === context.groupPublicKeyHex } finally { restored.free() }
    })
    expect(await verifyRecoveryPackage({ envelope: json, expectedContext: context, password, validateShare: validator })).toMatchObject({ status: "verified" })
    expect(validator).toHaveBeenCalledTimes(1)
    expect(borrowed?.every(byte => byte === 0)).toBe(true)
    secret.fill(0)
  })

  it("rejects wrong passwords and context substitutions without invoking the core validator", async () => {
    const { context, secret } = await fixture()
    const envelope = await createRecoveryPackage({ share: secret, context, password })
    const validator = vi.fn(async () => true)
    await expect(verifyRecoveryPackage({ envelope, expectedContext: context, password: "a different wrong password", validateShare: validator })).rejects.toThrow()
    for (const change of [{ accountId: "other" }, { walletId: "other" }, { network: "signet" as const }, { groupPublicKeyHex: "11".repeat(32) }, { participantId: "1", role: "A" as const }]) {
      await expect(verifyRecoveryPackage({ envelope, expectedContext: { ...context, ...change }, password, validateShare: validator })).rejects.toThrow()
    }
    expect(validator).not.toHaveBeenCalled()
    secret.fill(0)
  })

  it("refuses untrusted KDF parameters, oversized files, bad encodings and corrupted ciphertext", async () => {
    const { context, secret } = await fixture()
    const envelope = await createRecoveryPackage({ share: secret, context, password })
    expect(() => parseRecoveryPackage({ ...envelope, kdf: { ...envelope.kdf, iterations: 10_000_000_000 } })).toThrow()
    expect(() => parseRecoveryPackage("x".repeat(750_001))).toThrow()
    expect(() => parseRecoveryPackage({ ...envelope, ivHex: "00" })).toThrow()
    const last = envelope.ciphertextHex.endsWith("00") ? "01" : "00"
    await expect(decryptRecoveryPackage({ envelope: { ...envelope, ciphertextHex: envelope.ciphertextHex.slice(0, -2) + last }, expectedContext: context, password })).rejects.toThrow()
    secret.fill(0)
  })

  it("never equates successful decryption with a usable share and wipes failed validation input", async () => {
    const { context, secret } = await fixture()
    const envelope = await createRecoveryPackage({ share: secret, context, password })
    let borrowed: Uint8Array | undefined
    await expect(verifyRecoveryPackage({ envelope, expectedContext: context, password, validateShare: async ({ share }) => { borrowed = share; return false } })).rejects.toThrow("Core share validation failed")
    expect(borrowed?.every(byte => byte === 0)).toBe(true)
    secret.fill(0)
  })
})
