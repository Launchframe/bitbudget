// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { derivationContext, deriveWalletAddress } from "@/lib/wallet/derivation"
import { wrapDeviceShare, type ShareCustodyContext, type WalletPublicContext } from "@/lib/wallet/client-custody"
import { createRecoveryPackage } from "@/lib/wallet/recovery-package"
import { sealWalletWatchSeed } from "@/lib/wallet/watch-custody"
import { openWalletCustodyStore, type WalletCustodyStore } from "@/lib/wallet/wallet-idb"
import { custodyWatchId, isCustodyWatchId, openCustodyWatchSource } from "@/lib/wallet/watch-source"
import {
  LEDGER_SETTINGS_KEY_PREFIX,
  clearLedgerSettings,
  defaultExplorerForNetwork,
  defaultLedgerSettings,
  loadLedgerSettings,
  normalizeLedgerSettings,
  saveLedgerSettings,
} from "@/lib/wallet/ledger-settings"
import { decryptField } from "@/lib/crypto"

const seed = new Uint8Array(32).fill(9)
const context: WalletPublicContext = {
  accountId: "alice", walletId: "wallet-1", network: "signet", shareFormat: "frost-secp256k1-tr-v3",
  groupPublicKeyHex: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  publicPackageHex: "aabbcc", policy: { threshold: 2, participants: 3 }, derivationContext: derivationContext(seed),
}

let factory: IDBFactory
const stores: WalletCustodyStore[] = []
beforeEach(() => { factory = new IDBFactory(); window.localStorage.clear() })
afterEach(() => { for (const store of stores.splice(0)) store.close() })

async function createdRecord(privacyKey: Uint8Array, withWatch = true) {
  const store = await openWalletCustodyStore("alice", factory)
  stores.push(store)
  const a: ShareCustodyContext = { ...context, participantId: "1", role: "A" }
  const c: ShareCustodyContext = { ...context, participantId: "3", role: "C" }
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const prf = crypto.getRandomValues(new Uint8Array(32))
  try {
    return await store.createWallet({
      context,
      envelopes: {
        deviceShare: await wrapDeviceShare({ share: secret, context: a, credentialId: "cred", prfOutput: prf }),
        recoveryShare: await createRecoveryPackage({ share: secret, context: c, password: "synthetic-test-password", derivationSeed: seed }),
        optionalDeviceExport: null,
      },
      watchEnvelope: withWatch ? await sealWalletWatchSeed(seed, privacyKey, context) : undefined,
    })
  } finally { secret.fill(0); prf.fill(0) }
}

describe("custody wallet as a WatchSource", () => {
  it("derives the same addresses as deriveWalletAddress and zeroes the seed on dispose", async () => {
    const privacyKey = crypto.getRandomValues(new Uint8Array(32))
    const record = await createdRecord(privacyKey)
    const source = await openCustodyWatchSource({
      record, privacyKey, nickname: "Main", settings: defaultLedgerSettings("signet"),
    })
    expect(source.id).toBe("custody:wallet-1")
    expect(isCustodyWatchId(source.id)).toBe(true)
    expect(isCustodyWatchId("xpub-wallet")).toBe(false)
    expect(custodyWatchId("w")).toBe("custody:w")
    expect(source.ledgerSource).toBe("onchain_wallet")
    expect(source.explorerBaseUrl).toBe("https://mempool.space/signet")
    expect(source.deriveAddress(0, 0)).toBe(deriveWalletAddress(seed, context, "receive", 0).address)
    expect(source.deriveAddress(1, 5)).toBe(deriveWalletAddress(seed, context, "change", 5).address)
    expect(source.deriveAddress(0, 0)).toMatch(/^tb1p/)
    source.dispose()
    expect(() => source.deriveAddress(0, 1)).toThrow("already closed")
    source.dispose() // idempotent
    privacyKey.fill(0)
  })

  it("refuses to open without watch data or with the wrong privacy key", async () => {
    const privacyKey = crypto.getRandomValues(new Uint8Array(32))
    const record = await createdRecord(privacyKey)
    await expect(openCustodyWatchSource({
      record, privacyKey: crypto.getRandomValues(new Uint8Array(32)), nickname: "Main", settings: defaultLedgerSettings("signet"),
    })).rejects.toThrow()
    const noWatch = { ...record, watchEnvelope: null }
    await expect(openCustodyWatchSource({
      record: noWatch, privacyKey, nickname: "Main", settings: defaultLedgerSettings("signet"),
    })).rejects.toThrow("no watch data")
  })
})

describe("custody wallet ledger settings", () => {
  const userId = "user-1"

  it("has Savings-first defaults and per-network explorers", () => {
    const d = defaultLedgerSettings("signet")
    expect(d.receiveMode).toBe("savings")
    expect(d.defaultEnvelopeId).toBeNull()
    expect(d.gapLimit).toBe(20)
    expect(defaultExplorerForNetwork("mainnet")).toBe("https://mempool.space")
    expect(defaultExplorerForNetwork("testnet4")).toBe("https://mempool.space/testnet4")
    expect(defaultExplorerForNetwork("regtest")).toMatch(/^http:\/\/127\.0\.0\.1/)
  })

  it("normalizes untrusted records field by field", () => {
    const n = normalizeLedgerSettings({ defaultEnvelopeId: "", receiveMode: "bogus", explorerBaseUrl: "https://x.example/api/", gapLimit: 9999, lastSyncAt: "nope" }, "signet")
    expect(n).toEqual({ defaultEnvelopeId: null, receiveMode: "savings", explorerBaseUrl: "https://x.example", gapLimit: 20, lastSyncAt: null })
    expect(normalizeLedgerSettings(null, "mainnet").explorerBaseUrl).toBe("https://mempool.space")
  })

  it("round-trips encrypted, merges patches, and never stores plaintext envelope ids", async () => {
    const privacyKey = crypto.getRandomValues(new Uint8Array(32))
    expect(await loadLedgerSettings(userId, privacyKey, "w1", "signet")).toEqual(defaultLedgerSettings("signet"))
    await saveLedgerSettings(userId, privacyKey, "w1", "signet", { defaultEnvelopeId: "env-groceries", receiveMode: "envelope" })
    await saveLedgerSettings(userId, privacyKey, "w1", "signet", { lastSyncAt: "2026-09-10T00:00:00.000Z" })
    const loaded = await loadLedgerSettings(userId, privacyKey, "w1", "signet")
    expect(loaded.defaultEnvelopeId).toBe("env-groceries")
    expect(loaded.receiveMode).toBe("envelope")
    expect(loaded.lastSyncAt).toBe("2026-09-10T00:00:00.000Z")
    // Other wallets are untouched.
    expect((await loadLedgerSettings(userId, privacyKey, "w2", "signet")).defaultEnvelopeId).toBeNull()

    const raw = window.localStorage.getItem(`${LEDGER_SETTINGS_KEY_PREFIX}${userId}`)!
    expect(raw).not.toContain("env-groceries")
    expect(await decryptField(raw, privacyKey)).toContain("env-groceries")
    await expect(loadLedgerSettings(userId, crypto.getRandomValues(new Uint8Array(32)), "w1", "signet")).rejects.toThrow()

    await clearLedgerSettings(userId, privacyKey, "w1")
    expect((await loadLedgerSettings(userId, privacyKey, "w1", "signet")).defaultEnvelopeId).toBeNull()
  })
})
