import { describe, expect, it, vi } from "vitest"
import {
  chainActivityCountsAsIncome,
  chainActivityCountsAsSpending,
  runwayWalletSats,
  sumConfirmedSats,
  walletWatchInformsHoldings,
} from "@/lib/wallet-confirmed-sats"
import {
  clearAllWalletWatches,
  getWalletWatchSnapshot,
  parseWalletWatches,
  patchWalletWatch,
  serializeWalletWatches,
  writeWalletWatches,
  type WalletWatch,
} from "@/lib/wallet-watch-store"

const wallet = (over: Partial<WalletWatch> = {}): WalletWatch => ({
  id: "w1",
  label: "Phone",
  role: "wallet",
  kind: "address",
  descriptor: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  confirmedSats: 100_000_000,
  updatedAt: null,
  ...over,
})

describe("runwayWalletSats", () => {
  it("sums confirmed sats across watches", () => {
    expect(
      sumConfirmedSats([
        { confirmedSats: 50_000_000 },
        { confirmedSats: 25_000_000 },
        { confirmedSats: -1 },
      ]),
    ).toBe(75_000_000)
  })

  it("leaves a dropped send in the sale placeholder only", () => {
    const watches = [
      { confirmedSats: 98_000_000, role: "wallet" },
    ]
    expect(runwayWalletSats(watches, 2_000_000)).toBe(98_000_000)
  })

  it("drops exchange coins that are already in an open sale", () => {
    const watches = [
      { confirmedSats: 98_000_000, role: "wallet" },
      { confirmedSats: 2_000_000, role: "exchange" },
    ]
    expect(runwayWalletSats(watches, 2_000_000)).toBe(98_000_000)
  })

  it("subtracts only the sale size when the exchange balance is larger", () => {
    const watches = [{ confirmedSats: 10_000_000, role: "exchange" }]
    expect(runwayWalletSats(watches, 2_000_000)).toBe(8_000_000)
  })

  it("keeps a refreshed exchange balance once the sale is cash, not bitcoin on the way", () => {
    const watches = [{ confirmedSats: 8_000_000, role: "exchange" }]
    expect(runwayWalletSats(watches, 0)).toBe(8_000_000)
    expect(runwayWalletSats(watches, Number.NaN)).toBe(8_000_000)
  })
})

describe("walletWatchInformsHoldings", () => {
  it("ignores an unsynced empty watch and accepts a reading or a balance", () => {
    expect(walletWatchInformsHoldings([{ confirmedSats: 0, updatedAt: null }])).toBe(false)
    expect(walletWatchInformsHoldings([{ confirmedSats: 0, updatedAt: "" }])).toBe(false)
    expect(
      walletWatchInformsHoldings([
        { confirmedSats: 0, updatedAt: "2026-11-18T00:00:00.000Z" },
      ]),
    ).toBe(true)
    expect(walletWatchInformsHoldings([{ confirmedSats: 1, updatedAt: null }])).toBe(true)
  })
})

describe("chain activity", () => {
  it("counts only a categorized spend as spending", () => {
    expect(chainActivityCountsAsSpending("spend")).toBe(true)
    expect(chainActivityCountsAsSpending("sent_to_sell")).toBe(false)
    expect(chainActivityCountsAsSpending("collateral_post")).toBe(false)
    expect(chainActivityCountsAsSpending("uncategorized")).toBe(false)
  })

  it("never treats a chain row as income", () => {
    expect(chainActivityCountsAsIncome("collateral_return")).toBe(false)
    expect(chainActivityCountsAsIncome("uncategorized")).toBe(false)
  })
})

describe("parseWalletWatches", () => {
  it("round-trips a public watch and drops a seed", () => {
    const raw = serializeWalletWatches([
      wallet(),
      wallet({
        id: "seed",
        descriptor: "abandon abandon abandon abandon abandon abandon",
      }),
      wallet({ id: "prv", descriptor: "xprv9s21ZrQH143K" }),
      wallet({ id: "tprv", descriptor: "tprv8ZgxMB5j3X9oL22ZqN2P2eWnQyVKuCbddvJ6Rv3F" }),
      wallet({ id: "uprv", descriptor: "uprv8ZgxMBpe2G3k3Q" }),
      wallet({ id: "vprv", descriptor: "vprv8ZgxMBpe2G3k3Q" }),
      wallet({ id: "desc", descriptor: "wpkh(xprv9s21ZrQH143K3QT)" }),
      wallet({ id: "origin", descriptor: "[deadbeef]tprv8ZgxMBpe2G" }),
      wallet({ id: "wif", descriptor: "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ" }),
      wallet({ id: "twif", descriptor: `9${"a".repeat(50)}` }),
      wallet({ id: "cwif", descriptor: `c${"a".repeat(51)}` }),
      wallet({ id: "hex", descriptor: "0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d" }),
      wallet({
        id: "hex0x",
        descriptor: "0x0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d",
      }),
      wallet({ id: "mini", descriptor: `S${"a".repeat(29)}` }),
      wallet({ id: "bip38", descriptor: `6P${"a".repeat(56)}` }),
    ])
    const parsed = parseWalletWatches(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.descriptor.startsWith("bc1q")).toBe(true)
  })

  it("keeps public descriptors", () => {
    const raw = serializeWalletWatches([
      wallet({ id: "xpub", kind: "xpub", descriptor: "xpub661MyMwAqRbcFtXgS" }),
      wallet({ id: "tpub", kind: "xpub", descriptor: "tpubD6NzVbkrYhZx" }),
      wallet({ id: "upub", kind: "xpub", descriptor: "upub5EJj3qAbCd" }),
      wallet({ id: "nested", kind: "xpub", descriptor: "wpkh(xpub661MyMwAqRbcFtXgS)" }),
      wallet({ id: "s-short", descriptor: `s${"a".repeat(19)}` }),
      wallet({ id: "s-long", descriptor: `s${"a".repeat(40)}` }),
    ])
    expect(parseWalletWatches(raw).map((row) => row.id)).toEqual([
      "xpub",
      "tpub",
      "upub",
      "nested",
      "s-short",
      "s-long",
    ])
  })

  it("returns an empty list for junk", () => {
    expect(parseWalletWatches("not json")).toEqual([])
    expect(parseWalletWatches(null)).toEqual([])
  })
})

describe("wallet watch storage", () => {
  function installMemoryStorage() {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
      key: (index: number) => Array.from(data.keys())[index] ?? null,
      get length() {
        return data.size
      },
    }
    vi.stubGlobal("window", { localStorage: storage })
  }

  it("keeps each account's watches separate and clears them on logout", () => {
    installMemoryStorage()
    writeWalletWatches("user_a", [wallet({ id: "a", confirmedSats: 10 })])
    writeWalletWatches("user_b", [wallet({ id: "b", confirmedSats: 20 })])
    expect(getWalletWatchSnapshot("user_a").map((row) => row.id)).toEqual(["a"])
    expect(getWalletWatchSnapshot("user_b").map((row) => row.id)).toEqual(["b"])
    expect(getWalletWatchSnapshot(null)).toEqual([])

    clearAllWalletWatches()
    expect(getWalletWatchSnapshot("user_a")).toEqual([])
    expect(getWalletWatchSnapshot("user_b")).toEqual([])
    vi.unstubAllGlobals()
  })

  it("does not restore an address that was removed before refresh finished", () => {
    installMemoryStorage()
    writeWalletWatches("user_a", [wallet({ id: "gone", confirmedSats: 0 })])
    writeWalletWatches("user_a", [])
    patchWalletWatch("user_a", "gone", { confirmedSats: 50_000, updatedAt: "2026-11-12T00:00:00.000Z" })
    expect(getWalletWatchSnapshot("user_a")).toEqual([])
    vi.unstubAllGlobals()
  })

  it("removes one watch without dropping a row added before React re-renders", () => {
    installMemoryStorage()
    writeWalletWatches("user_a", [wallet({ id: "a", confirmedSats: 1 })])
    writeWalletWatches("user_a", [
      wallet({ id: "a", confirmedSats: 1 }),
      wallet({ id: "b", confirmedSats: 0 }),
    ])
    const current = getWalletWatchSnapshot("user_a")
    writeWalletWatches(
      "user_a",
      current.filter((watch) => watch.id !== "a"),
    )
    expect(getWalletWatchSnapshot("user_a").map((row) => row.id)).toEqual(["b"])
    vi.unstubAllGlobals()
  })

  it("ignores a fractional balance update instead of deleting the watch", () => {
    installMemoryStorage()
    writeWalletWatches("user_a", [wallet({ id: "keep", confirmedSats: 10 })])
    patchWalletWatch("user_a", "keep", {
      confirmedSats: 1.5,
      updatedAt: "2026-11-18T00:00:00.000Z",
    })
    expect(getWalletWatchSnapshot("user_a").map((row) => row.confirmedSats)).toEqual([10])
    patchWalletWatch("user_a", "keep", {
      confirmedSats: 40,
      updatedAt: "2026-11-18T00:00:00.000Z",
    })
    expect(getWalletWatchSnapshot("user_a").map((row) => row.confirmedSats)).toEqual([40])
    vi.unstubAllGlobals()
  })
})
