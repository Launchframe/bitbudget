import { describe, expect, it, vi } from "vitest"
import {
  addressWatchAmountLabel,
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

  it("rejects testnet extended private keys", () => {
    expect(addressWatchError("tprv8ZgxMBpe2G3k3Q")).toMatch(/key/i)
    expect(addressWatchError("uprv8ZgxMBpe2G3k3Q")).toMatch(/key/i)
    expect(addressWatchError("vprv8ZgxMBpe2G3k3Q")).toMatch(/key/i)
  })
})

describe("addressWatchAmountLabel", () => {
  const formatBalance = (sats: number) => `${sats} sats`

  it("does not present an unread row as a zero balance", () => {
    const unread = { confirmedSats: 0, updatedAt: null }
    expect(addressWatchAmountLabel(unread, true, formatBalance)).toBe("Checking…")
    expect(addressWatchAmountLabel(unread, false, formatBalance)).toBe("Not checked yet")
    expect(addressWatchAmountLabel({ confirmedSats: 0, updatedAt: "" }, false, formatBalance)).toBe(
      "Not checked yet",
    )
  })

  it("shows the last balance once a lookup has succeeded", () => {
    const read = { confirmedSats: 0, updatedAt: "2026-11-19T00:00:00.000Z" }
    expect(addressWatchAmountLabel(read, true, formatBalance)).toBe("0 sats")
    expect(addressWatchAmountLabel(read, false, formatBalance)).toBe("0 sats")
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
    expect(
      confirmedSatsFromEsploraBody({
        chain_stats: { funded_txo_sum: 1.5, spent_txo_sum: 0 },
      }),
    ).toBeNull()
    expect(
      confirmedSatsFromEsploraBody({
        chain_stats: { funded_txo_sum: -1, spent_txo_sum: 0 },
      }),
    ).toBeNull()
  })

  it("clamps a confirmed balance that would otherwise go negative", () => {
    expect(
      confirmedSatsFromEsploraBody({
        chain_stats: { funded_txo_sum: 1, spent_txo_sum: 5 },
      }),
    ).toBe(0)
  })
})

describe("fetchAddressConfirmedSats", () => {
  it("reads confirmed sats from the esplora response", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        chain_stats: { funded_txo_sum: 10, spent_txo_sum: 3 },
      }),
    })) as unknown as typeof fetch

    await expect(
      fetchAddressConfirmedSats("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", {
        fetchFn,
        baseUrl: "https://example.test/api",
      }),
    ).resolves.toBe(7)
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.test/api/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    )
  })

  it("lowercases a bech32 address in the request URL", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        address: "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
        chain_stats: { funded_txo_sum: 4, spent_txo_sum: 1 },
      }),
    })) as unknown as typeof fetch

    await expect(
      fetchAddressConfirmedSats("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", {
        fetchFn,
        baseUrl: "https://example.test/api/",
      }),
    ).resolves.toBe(3)
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.test/api/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      expect.any(Object),
    )
  })

  it("throws without reading the body when the explorer rejects the address", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      json: async () => {
        throw new Error("body should not be read")
      },
    })) as unknown as typeof fetch

    await expect(
      fetchAddressConfirmedSats("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", {
        fetchFn,
        baseUrl: "https://example.test/api",
      }),
    ).rejects.toThrow(/Address lookup failed/)
  })

  it("throws when the body is for a different address", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        chain_stats: { funded_txo_sum: 10, spent_txo_sum: 0 },
      }),
    })) as unknown as typeof fetch

    await expect(
      fetchAddressConfirmedSats("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", {
        fetchFn,
        baseUrl: "https://example.test/api",
      }),
    ).rejects.toThrow(/Address lookup failed/)
  })

  it("throws when the body has no confirmed totals", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        chain_stats: { funded_txo_sum: "10", spent_txo_sum: 0 },
      }),
    })) as unknown as typeof fetch

    await expect(
      fetchAddressConfirmedSats("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", {
        fetchFn,
        baseUrl: "https://example.test/api",
      }),
    ).rejects.toThrow(/Address lookup failed/)
  })
})
