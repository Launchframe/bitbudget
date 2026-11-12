import { describe, expect, it, vi } from "vitest"
import {
  chainActivityCountsAsIncome,
  chainActivityCountsAsSpending,
  runwayWalletSats,
  sumConfirmedSats,
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
      wallet({ id: "wif", descriptor: "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ" }),
      wallet({ id: "hex", descriptor: "0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d" }),
    ])
    const parsed = parseWalletWatches(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.descriptor.startsWith("bc1q")).toBe(true)
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
})
