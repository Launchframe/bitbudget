// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  addressKey,
  clearWalletDb,
  deleteWalletData,
  getAddressesForWallet,
  getImportedTxidsForWallet,
  getMeta,
  hasImportedTxid,
  putAddresses,
  putMeta,
  recordImportedTxid,
  txidKey,
} from "@/lib/wallets/xpub-cache"

const USER = "user-1"

beforeEach(async () => {
  await clearWalletDb(USER)
})

describe("xpub-cache key helpers", () => {
  it("addressKey is deterministic and uniqueness-preserving", () => {
    expect(addressKey("w", 0, 1)).toBe("w|0|1")
    expect(addressKey("w", 1, 1)).toBe("w|1|1")
    expect(addressKey("w", 0, 1)).not.toBe(addressKey("w", 0, 2))
  })

  it("txidKey scopes by wallet", () => {
    expect(txidKey("w", "abc")).toBe("w|abc")
    expect(txidKey("w", "abc")).not.toBe(txidKey("w2", "abc"))
  })
})

describe("xpub-cache: addresses", () => {
  it("stores and retrieves derived addresses by wallet", async () => {
    await putAddresses(USER, [
      { key: addressKey("w1", 0, 0), walletId: "w1", chain: 0, index: 0, address: "a0", used: false, lastSeenAt: null },
      { key: addressKey("w1", 0, 1), walletId: "w1", chain: 0, index: 1, address: "a1", used: true, lastSeenAt: "2026-05-09T00:00:00Z" },
      { key: addressKey("w2", 0, 0), walletId: "w2", chain: 0, index: 0, address: "b0", used: false, lastSeenAt: null },
    ])
    const w1 = await getAddressesForWallet(USER, "w1")
    expect(w1.map((a) => a.address).sort()).toEqual(["a0", "a1"])
    const w2 = await getAddressesForWallet(USER, "w2")
    expect(w2.map((a) => a.address)).toEqual(["b0"])
  })
})

describe("xpub-cache: txid dedup", () => {
  it("records and detects imported txids per wallet", async () => {
    expect(await hasImportedTxid(USER, "w1", "txA")).toBe(false)
    await recordImportedTxid(USER, {
      walletId: "w1",
      txid: "txA",
      bitbudgetTxnId: "bb_1",
      blockHeight: 800000,
      importedAt: "2026-05-09T00:00:00Z",
    })
    expect(await hasImportedTxid(USER, "w1", "txA")).toBe(true)
    expect(await hasImportedTxid(USER, "w2", "txA")).toBe(false)
    const list = await getImportedTxidsForWallet(USER, "w1")
    expect(list).toHaveLength(1)
    expect(list[0]!.bitbudgetTxnId).toBe("bb_1")
  })
})

describe("xpub-cache: meta", () => {
  it("round-trips per-wallet sync meta", async () => {
    await putMeta(USER, {
      walletId: "w1",
      lastSyncedAt: "2026-05-09T00:00:00Z",
      externalScanHigh: 35,
      changeScanHigh: 10,
      lastTipHeight: 800123,
    })
    const m = await getMeta(USER, "w1")
    expect(m).not.toBeNull()
    expect(m!.externalScanHigh).toBe(35)
    expect(m!.lastTipHeight).toBe(800123)
  })
})

describe("xpub-cache: deleteWalletData", () => {
  it("removes addresses, txids, and meta scoped to one wallet", async () => {
    await putAddresses(USER, [
      { key: addressKey("w1", 0, 0), walletId: "w1", chain: 0, index: 0, address: "a", used: false, lastSeenAt: null },
      { key: addressKey("w2", 0, 0), walletId: "w2", chain: 0, index: 0, address: "b", used: false, lastSeenAt: null },
    ])
    await recordImportedTxid(USER, {
      walletId: "w1",
      txid: "tx1",
      bitbudgetTxnId: null,
      blockHeight: null,
      importedAt: "2026-05-09T00:00:00Z",
    })
    await recordImportedTxid(USER, {
      walletId: "w2",
      txid: "tx2",
      bitbudgetTxnId: null,
      blockHeight: null,
      importedAt: "2026-05-09T00:00:00Z",
    })
    await putMeta(USER, {
      walletId: "w1",
      lastSyncedAt: null,
      externalScanHigh: 0,
      changeScanHigh: 0,
      lastTipHeight: null,
    })

    await deleteWalletData(USER, "w1")

    expect(await getAddressesForWallet(USER, "w1")).toEqual([])
    expect(await getImportedTxidsForWallet(USER, "w1")).toEqual([])
    expect(await getMeta(USER, "w1")).toBeNull()

    expect(await getAddressesForWallet(USER, "w2")).toHaveLength(1)
    expect(await getImportedTxidsForWallet(USER, "w2")).toHaveLength(1)
  })
})
