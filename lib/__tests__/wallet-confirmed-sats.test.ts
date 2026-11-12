import { describe, expect, it } from "vitest"
import {
  chainActivityCountsAsIncome,
  chainActivityCountsAsSpending,
  runwayWalletSats,
  sumConfirmedSats,
} from "@/lib/wallet-confirmed-sats"
import { parseWalletWatches, serializeWalletWatches, type WalletWatch } from "@/lib/wallet-watch-store"

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
