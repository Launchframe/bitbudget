import { describe, expect, it, vi } from "vitest"
import {
  addressWatchError,
  canonicalBitcoinAddress,
  confirmedSatsFromEsploraBody,
  fetchAddressConfirmedSats,
} from "@/lib/esplora-address"

describe("addressWatchError", () => {
  it("accepts a bech32 address", () => {
    expect(addressWatchError("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBeNull()
  })

  it("rejects a seed and a private key", () => {
    expect(addressWatchError("abandon abandon abandon abandon")).toMatch(/seed/i)
    expect(addressWatchError("xprv9s21ZrQH143K3")).toMatch(/key/i)
  })

  it("rejects an xpub in the address box", () => {
    expect(addressWatchError("xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8")).toMatch(/key/i)
  })

  it("rejects a private key and lowercases bech32", () => {
    expect(addressWatchError("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ")).toMatch(/key/i)
    const mixed = "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"
    expect(addressWatchError(mixed)).toBeNull()
    expect(canonicalBitcoinAddress(mixed)).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")
  })
})

describe("confirmedSatsFromEsploraBody", () => {
  it("uses confirmed chain stats only", () => {
    expect(
      confirmedSatsFromEsploraBody({
        chain_stats: { funded_txo_sum: 150_000, spent_txo_sum: 50_000 },
        mempool_stats: { funded_txo_sum: 999, spent_txo_sum: 0 },
      }),
    ).toBe(100_000)
  })

  it("returns null for a broken body", () => {
    expect(confirmedSatsFromEsploraBody(null)).toBeNull()
    expect(confirmedSatsFromEsploraBody({ chain_stats: {} })).toBeNull()
  })
})

describe("fetchAddressConfirmedSats", () => {
  it("reads confirmed sats from the esplora response", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ chain_stats: { funded_txo_sum: 10, spent_txo_sum: 3 } }),
    })) as unknown as typeof fetch

    await expect(
      fetchAddressConfirmedSats("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", {
        fetchFn,
        baseUrl: "https://example.test/api",
      }),
    ).resolves.toBe(7)
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.test/api/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
