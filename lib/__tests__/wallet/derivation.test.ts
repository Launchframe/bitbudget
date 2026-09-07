import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { sha256 } from "@noble/hashes/sha2.js"
import { bech32m } from "@scure/base"
import { derivationContext, derivationSeedHash, deriveAddressTweak, deriveWalletAddress, outputKeyAddress, tweakOutputKey } from "@/lib/wallet/derivation"
import type { WalletPublicContext } from "@/lib/wallet/client-custody"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"
import { openWalletWatchSeed, sealWalletWatchSeed } from "@/lib/wallet/watch-custody"

const seed = new Uint8Array(32).fill(7)
const context: WalletPublicContext = {
  accountId: "account", walletId: "wallet", network: "regtest", shareFormat: "frost-secp256k1-tr-v3",
  groupPublicKeyHex: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  publicPackageHex: "aabbcc", policy: { threshold: 2, participants: 3 }, derivationContext: derivationContext(seed),
}

describe("private wallet address derivation", () => {
  it("uses a fixed-width domain-separated HMAC and keeps both lineages on the same identity", () => {
    const encoded = Buffer.concat([Buffer.from("BitBudget/FROST/derive/v1"), Buffer.from(sha256(Buffer.from(context.publicPackageHex, "hex"))), Buffer.from([4, 0, 0, 0, 0, 17])])
    const expected = createHmac("sha256", seed).update(encoded).digest("hex")
    expect(Buffer.from(deriveAddressTweak(seed, context, "receive", 17)).toString("hex")).toBe(expected)
    const keys = [deriveWalletAddress(seed, context, "receive", 0), deriveWalletAddress(seed, context, "receive", 1), deriveWalletAddress(seed, context, "change", 0), deriveWalletAddress(seed, { ...context, network: "signet" }, "receive", 0)]
    expect(new Set(keys.map(key => key.outputKeyHex)).size).toBe(4)
    expect(keys[0].scriptPubKeyHex).toBe(`5120${keys[0].outputKeyHex}`)
    const decoded = bech32m.decode(keys[0].address as `${string}1${string}`)
    expect(decoded.prefix).toBe("bcrt")
    expect(decoded.words[0]).toBe(1)
    expect(Buffer.from(bech32m.fromWords(decoded.words.slice(1))).toString("hex")).toBe(keys[0].outputKeyHex)
  })

  it("encrypts watch-only derivation material with account, wallet and network binding", async () => {
    const privacyKey = crypto.getRandomValues(new Uint8Array(32))
    const envelope = await sealWalletWatchSeed(seed, privacyKey, context)
    expect(JSON.stringify(envelope)).not.toContain(Buffer.from(seed).toString("hex"))
    const opened = await openWalletWatchSeed(envelope, privacyKey, context)
    expect(opened).toEqual(seed)
    opened.fill(0)
    for (const change of [{ walletId: "other" }, { accountId: "other" }, { network: "signet" as const }]) await expect(openWalletWatchSeed(envelope, privacyKey, { ...context, ...change })).rejects.toThrow("context mismatch")
    await expect(openWalletWatchSeed(envelope, crypto.getRandomValues(new Uint8Array(32)), context)).rejects.toThrow()
    privacyKey.fill(0)
  })

  it("refuses wrong seeds, invalid indices and unsupported derivation policies", () => {
    expect(derivationSeedHash("base-output-v1")).toBeNull()
    expect(() => derivationSeedHash("invented-policy")).toThrow()
    expect(() => deriveWalletAddress(new Uint8Array(32), context, "receive", 0)).toThrow("seed mismatch")
    for (const index of [-1, 0.5, 0x80000000, NaN]) expect(() => deriveWalletAddress(seed, context, "receive", index)).toThrow("index")
    expect(() => tweakOutputKey("00".repeat(31), seed)).toThrow()
    expect(() => outputKeyAddress(new Uint8Array(31), "regtest")).toThrow()
  })

  it("matches real FROST child public packages without using private shares in address generation", async () => {
    const core = await loadWalletMpc()
    const ids = [1, 2, 3]
    const first = ids.map(id => new core.WasmDkgRound1(id))
    const broadcasts = first.map(value => value.broadcast())
    const second = first.map((value, index) => { const peers = ids.filter(id => id !== index + 1); return value.advance(peers[0], broadcasts[peers[0] - 1], peers[1], broadcasts[peers[1] - 1]) })
    const messages = second.map((value, index) => new Map(ids.filter(id => id !== index + 1).map(id => [id, value.take_message(id)])))
    const shares = second.map((value, index) => { const peers = ids.filter(id => id !== index + 1); return value.finish(peers[0], messages[peers[0] - 1].get(index + 1)!, peers[1], messages[peers[1] - 1].get(index + 1)!) })
    try {
      const publicPackage = shares[0].public_package()
      const actual = { ...context, groupPublicKeyHex: Buffer.from(shares[0].output_key()).toString("hex"), publicPackageHex: Buffer.from(publicPackage).toString("hex") }
      for (const branch of ["receive", "change"] as const) for (const index of [0, 1, 25]) {
        const address = deriveWalletAddress(seed, actual, branch, index)
        const tweak = Buffer.from(address.merkleRootHex, "hex")
        const derived = core.derive_public_package(publicPackage, tweak)
        expect(Buffer.from(core.public_package_output_key(derived)).toString("hex")).toBe(address.outputKeyHex)
        for (const share of shares) {
          const child = share.derive_child(tweak)
          try { expect(Buffer.from(child.public_package())).toEqual(Buffer.from(derived)) } finally { child.free() }
        }
      }
    } finally {
      for (const share of shares) share.free()
      for (const map of messages) for (const bytes of map.values()) bytes.fill(0)
    }
  })
})
