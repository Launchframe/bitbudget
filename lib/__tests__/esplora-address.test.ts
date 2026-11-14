import { describe, expect, it, vi } from "vitest"
import {
  addressWatchError,
  canonicalBitcoinAddress,
  chainMovementsFromEsploraTxs,
  confirmedSatsFromEsploraBody,
  fetchAddressChainMovements,
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

const ADDR = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"

describe("chainMovementsFromEsploraTxs", () => {
  it("keeps confirmed receives and sends and drops mempool rows", () => {
    const rows = chainMovementsFromEsploraTxs(ADDR, [
      {
        txid: "aa",
        status: { confirmed: true, block_time: 1_700_000_000 },
        vin: [],
        vout: [{ scriptpubkey_address: ADDR, value: 75_000_000 }],
      },
      {
        txid: "bb",
        status: { confirmed: true, block_time: 1_710_000_000 },
        vin: [{ prevout: { scriptpubkey_address: ADDR, value: 25_000_000 } }],
        vout: [],
      },
      {
        txid: "cc",
        status: { confirmed: false },
        vin: [],
        vout: [{ scriptpubkey_address: ADDR, value: 9_000 }],
      },
      {
        txid: "dd",
        status: { confirmed: true, block_time: 1_720_000_000 },
        vin: [],
        vout: [{ scriptpubkey_address: "bc1qother", value: 1_000 }],
      },
    ])
    expect(rows).toEqual([
      { txid: "bb", time: 1_710_000_000, netSats: -25_000_000 },
      { txid: "aa", time: 1_700_000_000, netSats: 75_000_000 },
    ])
  })

  it("matches bech32 in either case, keeps base58 case, and nets change", () => {
    const base58 = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    expect(
      chainMovementsFromEsploraTxs(base58, [
        {
          txid: "wrong-case",
          status: { confirmed: true, block_time: 300 },
          vin: [],
          vout: [{ scriptpubkey_address: base58.toLowerCase(), value: 5 }],
        },
        {
          txid: "exact",
          status: { confirmed: true, block_time: 100 },
          vin: [],
          vout: [{ scriptpubkey_address: base58, value: 7 }],
        },
      ]).map((row) => row.txid),
    ).toEqual(["exact"])

    expect(
      chainMovementsFromEsploraTxs(ADDR.toUpperCase(), [
        {
          txid: "change",
          status: { confirmed: true, block_time: 10 },
          vin: [{ prevout: { scriptpubkey_address: ADDR, value: 100 } }],
          vout: [{ scriptpubkey_address: ADDR.toUpperCase(), value: 40 }],
        },
        {
          txid: "later",
          status: { confirmed: true, block_time: 20 },
          vin: [],
          vout: [{ scriptpubkey_address: ADDR, value: 3 }],
        },
        {
          txid: "undated",
          status: { confirmed: true, block_time: Number.POSITIVE_INFINITY },
          vin: [],
          vout: [{ scriptpubkey_address: ADDR, value: 1 }],
        },
      ]),
    ).toEqual([
      { txid: "later", time: 20, netSats: 3 },
      { txid: "change", time: 10, netSats: -60 },
      { txid: "undated", time: null, netSats: 1 },
    ])
  })

  it("returns nothing for a non-list body", () => {
    expect(chainMovementsFromEsploraTxs(ADDR, null)).toEqual([])
  })
})

describe("fetchAddressChainMovements", () => {
  it("requests the address txs endpoint", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          txid: "aa",
          status: { confirmed: true, block_time: 1_700_000_000 },
          vin: [],
          vout: [{ scriptpubkey_address: ADDR, value: 5_000 }],
        },
      ],
    })) as unknown as typeof fetch

    await expect(
      fetchAddressChainMovements(ADDR, { fetchFn, baseUrl: "https://example.test/api" }),
    ).resolves.toEqual([{ txid: "aa", time: 1_700_000_000, netSats: 5_000 }])
    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test/api/address/${ADDR}/txs`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("uses the canonical address and rejects a body that is not a list", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ error: "no" }),
    })) as unknown as typeof fetch

    await expect(
      fetchAddressChainMovements(ADDR.toUpperCase(), {
        fetchFn,
        baseUrl: "https://example.test/api",
      }),
    ).rejects.toThrow(/activity/i)
    expect(fetchFn).toHaveBeenCalledWith(
      `https://example.test/api/address/${ADDR}/txs`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
