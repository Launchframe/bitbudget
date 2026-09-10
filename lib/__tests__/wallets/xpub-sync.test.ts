// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { webcrypto } from "node:crypto"
import { EsploraClient, type EsploraTx, type FetchLike } from "@/lib/wallets/esplora-client"
import {
  buildTransactionPayload,
  isPureSelfTransfer,
  netSatsForTx,
  resolveLedgerEnvelopeId,
  runSync,
  unixSecondsToIsoDate,
  xpubWatchSource,
  type WatchSource,
} from "@/lib/wallets/xpub-sync"
import {
  clearWalletDb,
  getAddressesForWallet,
  getImportedTxidsForWallet,
  getMeta,
  getUsedAddressesForOtherWallets,
  hasImportedTxid,
  hasImportedTxidAnyWallet,
} from "@/lib/wallets/xpub-cache"
import { deriveAddress, parseExtendedKey } from "@/lib/wallets/xpub-derive"
import { buildStoredWallet } from "@/lib/wallets/xpub-store"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs"
// Pre-derived from the BIP84 official vector.
const ADDR_R0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"
const ADDR_R1 = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"
const ADDR_C0 = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"
const ADDR_EXTERNAL = "bc1q123externalpaymentdestinationxxxxxxxxxx"

const USER = "user-1"

beforeEach(async () => {
  await clearWalletDb(USER)
})

describe("unixSecondsToIsoDate", () => {
  it("converts to YYYY-MM-DD UTC", () => {
    expect(unixSecondsToIsoDate(0)).toBe("1970-01-01")
    // 2024-04-01T00:00:00Z = 1711929600
    expect(unixSecondsToIsoDate(1711929600)).toBe("2024-04-01")
  })
})

describe("netSatsForTx", () => {
  const my = new Set([ADDR_R0, ADDR_R1, ADDR_C0])

  it("returns +inflow when only outputs are mine", () => {
    const tx: EsploraTx = {
      txid: "tx1", version: 1, size: 1, weight: 1, fee: 100,
      vin: [{ txid: "p", vout: 0, prevout: { scriptpubkey_address: "someone-else", value: 50000 } }],
      vout: [{ scriptpubkey_address: ADDR_R0, value: 49900 }],
      status: { confirmed: true, block_height: 800000, block_time: 1711929600 },
    }
    expect(netSatsForTx(tx, my)).toBe(49900)
  })

  it("returns -outflow when paying out to an external address (with change)", () => {
    const tx: EsploraTx = {
      txid: "tx2", version: 1, size: 1, weight: 1, fee: 200,
      vin: [{ txid: "p", vout: 0, prevout: { scriptpubkey_address: ADDR_R0, value: 100000 } }],
      vout: [
        { scriptpubkey_address: ADDR_EXTERNAL, value: 60000 },
        { scriptpubkey_address: ADDR_C0, value: 39800 },
      ],
      status: { confirmed: true, block_height: 800000, block_time: 1711929600 },
    }
    // I lose 100000 (input) and gain 39800 (change). Net = -60200.
    expect(netSatsForTx(tx, my)).toBe(-60200)
  })

  it("returns -fee for a pure self-transfer (consolidation)", () => {
    const tx: EsploraTx = {
      txid: "tx3", version: 1, size: 1, weight: 1, fee: 500,
      vin: [
        { txid: "p", vout: 0, prevout: { scriptpubkey_address: ADDR_R0, value: 50000 } },
        { txid: "q", vout: 0, prevout: { scriptpubkey_address: ADDR_R1, value: 50000 } },
      ],
      vout: [{ scriptpubkey_address: ADDR_C0, value: 99500 }],
      status: { confirmed: true, block_height: 800000, block_time: 1711929600 },
    }
    expect(netSatsForTx(tx, my)).toBe(-500)
  })

  it("ignores vin without a prevout (e.g. coinbase)", () => {
    const tx: EsploraTx = {
      txid: "cb", version: 1, size: 1, weight: 1, fee: 0,
      vin: [{ txid: "0".repeat(64), vout: 0, prevout: null }],
      vout: [{ scriptpubkey_address: ADDR_R0, value: 625000000 }],
      status: { confirmed: true, block_height: 800000, block_time: 1711929600 },
    }
    expect(netSatsForTx(tx, my)).toBe(625000000)
  })
})

describe("isPureSelfTransfer", () => {
  const my = new Set([ADDR_R0, ADDR_C0])

  it("true when every input and output is mine", () => {
    const tx = {
      txid: "x", version: 1, size: 1, weight: 1, fee: 1,
      vin: [{ txid: "p", vout: 0, prevout: { scriptpubkey_address: ADDR_R0, value: 1000 } }],
      vout: [{ scriptpubkey_address: ADDR_C0, value: 999 }],
      status: { confirmed: true, block_height: 1, block_time: 1 },
    } as EsploraTx
    expect(isPureSelfTransfer(tx, my)).toBe(true)
  })

  it("false when any output goes elsewhere", () => {
    const tx = {
      txid: "x", version: 1, size: 1, weight: 1, fee: 1,
      vin: [{ txid: "p", vout: 0, prevout: { scriptpubkey_address: ADDR_R0, value: 1000 } }],
      vout: [{ scriptpubkey_address: "other", value: 999 }],
      status: { confirmed: true, block_height: 1, block_time: 1 },
    } as EsploraTx
    expect(isPureSelfTransfer(tx, my)).toBe(false)
  })
})

describe("resolveLedgerEnvelopeId", () => {
  it("routes spends to the wallet envelope regardless of receive mode", () => {
    expect(resolveLedgerEnvelopeId({ defaultEnvelopeId: "env-a", receiveMode: "savings" }, "expense", "env-sav")).toBe("env-a")
    expect(resolveLedgerEnvelopeId({ defaultEnvelopeId: "env-a", receiveMode: "envelope" }, "expense", "env-sav")).toBe("env-a")
  })

  it("routes receives to Savings by default and to the wallet envelope when asked", () => {
    expect(resolveLedgerEnvelopeId({ defaultEnvelopeId: "env-a", receiveMode: "savings" }, "credit", "env-sav")).toBe("env-sav")
    expect(resolveLedgerEnvelopeId({ defaultEnvelopeId: "env-a", receiveMode: "envelope" }, "credit", "env-sav")).toBe("env-a")
  })

  it("never guesses an envelope: throws when one is required but unset", () => {
    expect(() => resolveLedgerEnvelopeId({ defaultEnvelopeId: null, receiveMode: "savings" }, "expense", "env-sav")).toThrow(/Choose an envelope/)
    expect(() => resolveLedgerEnvelopeId({ defaultEnvelopeId: null, receiveMode: "envelope" }, "credit", "env-sav")).toThrow(/Choose an envelope/)
    // Savings receives do not need a wallet envelope.
    expect(resolveLedgerEnvelopeId({ defaultEnvelopeId: null, receiveMode: "savings" }, "credit", "env-sav")).toBe("env-sav")
  })
})

describe("buildTransactionPayload", () => {
  const wallet = { id: "w1", nickname: "Cold", defaultEnvelopeId: "env-bitcoin", receiveMode: "savings" as const }

  it("builds an expense for a negative net delta", () => {
    const p = buildTransactionPayload({
      netSats: -100_000,
      blockTime: 1711929600,
      txid: "abc",
      blockHeight: 800001,
      wallet,
      savingsEnvelopeId: "env-savings",
      btcPriceOnDate: 70000,
    })
    expect(p.type).toBe("expense")
    expect(p.satsAmount).toBe(100_000)
    // 0.001 BTC * $70000 = $70
    expect(p.amount).toBeCloseTo(70, 6)
    expect(p.envelopeId).toBe("env-bitcoin")
    expect(p.payee).toBe("Bitcoin: Cold")
    expect(p.notes).toContain("abc")
    expect(p.source).toBe("onchain_xpub")
    expect(p.date).toBe("2024-04-01")
    expect(p.tags).toEqual([])
  })

  it("builds a credit into Savings when receiveMode is savings", () => {
    const p = buildTransactionPayload({
      netSats: 50_000,
      blockTime: 1711929600,
      txid: "def",
      blockHeight: 800001,
      wallet: { id: "w1", nickname: "Hot", defaultEnvelopeId: "env-bitcoin", receiveMode: "savings" },
      savingsEnvelopeId: "env-savings",
      btcPriceOnDate: 60000,
    })
    expect(p.type).toBe("credit")
    expect(p.envelopeId).toBe("env-savings")
    expect(p.payee).toBe("Bitcoin: Hot")
  })

  it("builds a credit into the wallet envelope when receiveMode is envelope", () => {
    const p = buildTransactionPayload({
      netSats: 50_000,
      blockTime: 1711929600,
      txid: "def",
      blockHeight: 800001,
      wallet: { id: "w1", nickname: "Hot", defaultEnvelopeId: "env-bitcoin", receiveMode: "envelope" },
      savingsEnvelopeId: "env-savings",
      btcPriceOnDate: 60000,
    })
    expect(p.type).toBe("credit")
    expect(p.envelopeId).toBe("env-bitcoin")
  })

  it("throws on a zero-delta input (should be filtered upstream)", () => {
    expect(() =>
      buildTransactionPayload({
        netSats: 0,
        blockTime: 1, txid: "z", blockHeight: 0,
        wallet, savingsEnvelopeId: "f", btcPriceOnDate: 1,
      }),
    ).toThrow()
  })
})

// ─── End-to-end: gap-limit scan over a mocked Esplora ────────────────

interface MockTx {
  txid: string
  vin: Array<{ addr: string; value: number }>
  vout: Array<{ addr: string; value: number }>
  blockTime: number
  blockHeight: number
}

function buildMockEsplora(opts: {
  byAddressTxs: Map<string, MockTx[]>
  tipHeight?: number
}): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = []
  const tipHeight = opts.tipHeight ?? 800100
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url)
    if (url.endsWith("/api/blocks/tip/height")) {
      return {
        ok: true,
        status: 200,
        text: async () => String(tipHeight),
        json: async () => tipHeight,
      }
    }
    const addrInfoMatch = url.match(/\/api\/address\/([^/]+)$/)
    if (addrInfoMatch) {
      const addr = addrInfoMatch[1]!
      const txs = opts.byAddressTxs.get(addr) ?? []
      const stats = {
        funded_txo_count: txs.length,
        funded_txo_sum: 0,
        spent_txo_count: 0,
        spent_txo_sum: 0,
        tx_count: txs.length,
      }
      const empty = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 }
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ address: addr, chain_stats: stats, mempool_stats: empty }),
      }
    }
    const addrTxsMatch = url.match(/\/api\/address\/([^/]+)\/txs$/)
    if (addrTxsMatch) {
      const addr = addrTxsMatch[1]!
      const mocks = opts.byAddressTxs.get(addr) ?? []
      const txs: EsploraTx[] = mocks.map((m) => ({
        txid: m.txid, version: 1, size: 1, weight: 1, fee: 0,
        vin: m.vin.map((v) => ({ txid: "p", vout: 0, prevout: { scriptpubkey_address: v.addr, value: v.value } })),
        vout: m.vout.map((v) => ({ scriptpubkey_address: v.addr, value: v.value })),
        status: { confirmed: true, block_height: m.blockHeight, block_time: m.blockTime },
      }))
      return { ok: true, status: 200, text: async () => "", json: async () => txs }
    }
    if (url.includes("/txs/chain/")) {
      // Pagination follow-up: empty page ends paging.
      return { ok: true, status: 200, text: async () => "", json: async () => [] }
    }
    throw new Error(`Unexpected URL in mock Esplora: ${url}`)
  }
  return { fetchImpl, calls }
}

describe("runSync (mocked Esplora, BIP84 vector)", () => {
  const wallet = buildStoredWallet({
    nickname: "Test BIP84",
    xpub: ZPUB,
    kind: "bip84",
    explorerBaseUrl: "https://mempool.space",
    defaultEnvelopeId: "env-bitcoin",
    gapLimit: 5,
  })

  type SavedPayload = {
    payee: string
    type: "expense" | "credit"
    satsAmount?: number | null
    amount: number
    notes?: string | null
    envelopeId: string
    date: string
    source?: string
    tags: string[]
  }
  let savedPayloads: SavedPayload[] = []
  const saveTransaction = async (txn: SavedPayload) => {
    savedPayloads.push(txn)
    return `srv_${Math.random().toString(36).slice(2)}`
  }

  /** Find a saved payload whose notes contain the given txid substring. */
  const findByTxid = (txid: string): SavedPayload | undefined =>
    savedPayloads.find((p) => (p.notes ?? "").includes(txid))

  afterEach(() => {
    savedPayloads = []
  })

  it("imports one tx for the BIP84 receive address and skips a self-transfer", async () => {
    const mock = buildMockEsplora({
      byAddressTxs: new Map<string, MockTx[]>([
        // Inbound payment to receive index 0
        [
          ADDR_R0,
          [
            {
              txid: "TX_INBOUND",
              vin: [{ addr: "external_payer", value: 50_000 }],
              vout: [{ addr: ADDR_R0, value: 50_000 }],
              blockTime: 1711929600,
              blockHeight: 800050,
            },
            // Pure self-transfer (consolidation) — should be skipped, not turned into a tx.
            {
              txid: "TX_SELF",
              vin: [{ addr: ADDR_R0, value: 50_000 }],
              vout: [{ addr: ADDR_C0, value: 49_500 }],
              blockTime: 1711930000,
              blockHeight: 800051,
            },
          ],
        ],
        [
          ADDR_C0,
          [
            // Same self-transfer pulled in via the change address — must dedup by txid.
            {
              txid: "TX_SELF",
              vin: [{ addr: ADDR_R0, value: 50_000 }],
              vout: [{ addr: ADDR_C0, value: 49_500 }],
              blockTime: 1711930000,
              blockHeight: 800051,
            },
            // Outbound payment from the change address
            {
              txid: "TX_OUTBOUND",
              vin: [{ addr: ADDR_C0, value: 49_500 }],
              vout: [
                { addr: "external_merchant", value: 30_000 },
                { addr: ADDR_R1, value: 19_000 },
              ],
              blockTime: 1711931000,
              blockHeight: 800052,
            },
          ],
        ],
        // ADDR_R1 also sees the outbound tx (it received the change-back).
        // Without this, the scanner never marks R1 as ours and would
        // mis-classify the outbound's true net delta.
        [
          ADDR_R1,
          [
            {
              txid: "TX_OUTBOUND",
              vin: [{ addr: ADDR_C0, value: 49_500 }],
              vout: [
                { addr: "external_merchant", value: 30_000 },
                { addr: ADDR_R1, value: 19_000 },
              ],
              blockTime: 1711931000,
              blockHeight: 800052,
            },
          ],
        ],
      ]),
    })

    const client = new EsploraClient({
      baseUrl: wallet.explorerBaseUrl,
      fetchImpl: mock.fetchImpl,
      minRequestSpacingMs: 0,
    })

    const res = await runSync({
      userId: USER,
      wallet,
      savingsEnvelopeId: "env-savings",
      client,
      getPriceOnDate: () => 70000,
      saveTransaction: saveTransaction as never,
    })

    // We saved exactly the inbound and outbound txs (self-transfer skipped).
    const inbound = findByTxid("TX_INBOUND")
    const outbound = findByTxid("TX_OUTBOUND")
    const self = findByTxid("TX_SELF")
    expect(inbound).toBeDefined()
    expect(outbound).toBeDefined()
    expect(self).toBeUndefined()

    expect(res.txsImported).toBe(2)
    expect(inbound!.type).toBe("credit")
    expect(inbound!.satsAmount).toBe(50_000)
    expect(inbound!.source).toBe("onchain_xpub")
    // Default receive mode: receives grow Savings; spends debit the wallet envelope.
    expect(inbound!.envelopeId).toBe("env-savings")
    expect(outbound!.type).toBe("expense")
    expect(outbound!.envelopeId).toBe("env-bitcoin")
    expect(outbound!.satsAmount).toBe(30_500) // 49500 spent − 19000 returned

    // Self-transfer is recorded in the dedup cache so we don't reconsider it.
    expect(await hasImportedTxid(USER, wallet.id, "TX_SELF")).toBe(true)

    // Cache populated; gap-limit watermark reflects scan depth.
    const addrs = await getAddressesForWallet(USER, wallet.id)
    expect(addrs.length).toBeGreaterThan(0)
    const importedTxids = await getImportedTxidsForWallet(USER, wallet.id)
    expect(importedTxids.length).toBe(3) // 2 imported + 1 self-transfer recorded
  })

  it("picks up a new tx on a previously used address during incremental sync", async () => {
    const mock1 = buildMockEsplora({
      byAddressTxs: new Map<string, MockTx[]>([
        [
          ADDR_R0,
          [
            {
              txid: "TX_ONCE",
              vin: [{ addr: "external", value: 10000 }],
              vout: [{ addr: ADDR_R0, value: 10000 }],
              blockTime: 1711929600,
              blockHeight: 800050,
            },
          ],
        ],
      ]),
    })
    const client1 = new EsploraClient({
      baseUrl: wallet.explorerBaseUrl, fetchImpl: mock1.fetchImpl, minRequestSpacingMs: 0,
    })
    await runSync({
      userId: USER, wallet, savingsEnvelopeId: "env-savings", client: client1,
      getPriceOnDate: () => 70000, saveTransaction: saveTransaction as never,
    })
    expect(savedPayloads.length).toBe(1)

    const mock2 = buildMockEsplora({
      byAddressTxs: new Map<string, MockTx[]>([
        [
          ADDR_R0,
          [
            {
              txid: "TX_ONCE",
              vin: [{ addr: "external", value: 10000 }],
              vout: [{ addr: ADDR_R0, value: 10000 }],
              blockTime: 1711929600,
              blockHeight: 800050,
            },
            {
              txid: "TX_LATER",
              vin: [{ addr: "external", value: 5000 }],
              vout: [{ addr: ADDR_R0, value: 5000 }],
              blockTime: 1712016000,
              blockHeight: 800051,
            },
          ],
        ],
      ]),
    })
    const client2 = new EsploraClient({
      baseUrl: wallet.explorerBaseUrl, fetchImpl: mock2.fetchImpl, minRequestSpacingMs: 0,
    })
    const meta = await getMeta(USER, wallet.id)
    const resumeFrom = {
      externalIndex: Math.max(0, meta!.externalScanHigh - wallet.gapLimit),
      changeIndex: Math.max(0, meta!.changeScanHigh - wallet.gapLimit),
    }
    const r2 = await runSync({
      userId: USER, wallet, savingsEnvelopeId: "env-savings", client: client2,
      resumeFrom,
      getPriceOnDate: () => 70000, saveTransaction: saveTransaction as never,
    })
    expect(r2.txsImported).toBe(1)
    expect(savedPayloads.some((p) => p.notes?.includes("TX_LATER"))).toBe(true)
    expect(savedPayloads.length).toBe(2)
  })

  it("re-running the sync is idempotent (no duplicate writes)", async () => {
    const mock = buildMockEsplora({
      byAddressTxs: new Map<string, MockTx[]>([
        [
          ADDR_R0,
          [
            {
              txid: "TX_ONCE",
              vin: [{ addr: "external", value: 10000 }],
              vout: [{ addr: ADDR_R0, value: 10000 }],
              blockTime: 1711929600,
              blockHeight: 800050,
            },
          ],
        ],
      ]),
    })
    const client = new EsploraClient({
      baseUrl: wallet.explorerBaseUrl, fetchImpl: mock.fetchImpl, minRequestSpacingMs: 0,
    })
    const r1 = await runSync({
      userId: USER, wallet, savingsEnvelopeId: "env-savings", client,
      getPriceOnDate: () => 70000, saveTransaction: saveTransaction as never,
    })
    const meta = await getMeta(USER, wallet.id)
    expect(meta).not.toBeNull()
    const resumeFrom = {
      externalIndex: Math.max(0, meta!.externalScanHigh - wallet.gapLimit),
      changeIndex: Math.max(0, meta!.changeScanHigh - wallet.gapLimit),
    }
    const r2 = await runSync({
      userId: USER, wallet, savingsEnvelopeId: "env-savings", client,
      resumeFrom,
      getPriceOnDate: () => 70000, saveTransaction: saveTransaction as never,
    })
    expect(r1.txsImported).toBe(1)
    expect(r2.txsImported).toBe(0)
    expect(r2.scannedAddresses).toBeLessThan(r1.scannedAddresses)
    expect(savedPayloads.length).toBe(1)
  })
})

// ─── Multi-wallet accounting ─────────────────────────────────────────

describe("runSync across two watched wallets", () => {
  const XPUB44 =
    "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz"
  const walletA = buildStoredWallet({
    nickname: "A", xpub: ZPUB, kind: "bip84", explorerBaseUrl: "https://mempool.space",
    defaultEnvelopeId: "env-a", gapLimit: 3,
  })
  const walletB = buildStoredWallet({
    nickname: "B", xpub: XPUB44, kind: "bip44", explorerBaseUrl: "https://mempool.space",
    defaultEnvelopeId: "env-b", gapLimit: 3,
  })
  const B_R0 = deriveAddress(parseExtendedKey(XPUB44), 0, 0)

  type Saved = { type: "expense" | "credit"; notes?: string | null; envelopeId: string }
  let saved: Saved[] = []
  const saveTransaction = async (txn: Saved) => { saved.push(txn); return `srv_${saved.length}` }
  afterEach(() => { saved = [] })

  const fund: MockTx = {
    txid: "TX_FUND", vin: [{ addr: "external", value: 50_000 }], vout: [{ addr: ADDR_R0, value: 50_000 }],
    blockTime: 1711929600, blockHeight: 800050,
  }
  const move: MockTx = {
    txid: "TX_MOVE", vin: [{ addr: ADDR_R0, value: 50_000 }], vout: [{ addr: B_R0, value: 49_500 }],
    blockTime: 1711930000, blockHeight: 800051,
  }
  const mock = () => buildMockEsplora({
    byAddressTxs: new Map<string, MockTx[]>([[ADDR_R0, [fund, move]], [B_R0, [move]]]),
  })
  const clientFor = (fetchImpl: FetchLike) =>
    new EsploraClient({ baseUrl: "https://mempool.space", fetchImpl, minRequestSpacingMs: 0 })

  it("two-pass sync nets a transfer between the user's wallets to a self-transfer", async () => {
    const m = mock()
    const client = clientFor(m.fetchImpl)
    const base = { userId: USER, savingsEnvelopeId: "env-savings", client, getPriceOnDate: () => 70000, saveTransaction: saveTransaction as never }

    // Pass 1: addresses only.
    await runSync({ ...base, wallet: walletA, importTransactions: false })
    await runSync({ ...base, wallet: walletB, importTransactions: false })
    expect(saved).toHaveLength(0)
    expect((await getUsedAddressesForOtherWallets(USER, walletA.id)).has(B_R0)).toBe(true)

    // Pass 2: classify with every wallet's addresses known.
    await runSync({ ...base, wallet: walletA, otherWalletAddresses: await getUsedAddressesForOtherWallets(USER, walletA.id) })
    await runSync({ ...base, wallet: walletB, otherWalletAddresses: await getUsedAddressesForOtherWallets(USER, walletB.id) })

    expect(saved.map((s) => s.type)).toEqual(["credit"])
    expect(saved[0]!.notes).toContain("TX_FUND")
    expect(saved[0]!.envelopeId).toBe("env-savings")
    expect(await hasImportedTxidAnyWallet(USER, "TX_MOVE")).toBe(true)
    // Both wallets remember the tx so removing either cleans up its own cache.
    expect(await hasImportedTxid(USER, walletA.id, "TX_MOVE")).toBe(true)
    expect(await hasImportedTxid(USER, walletB.id, "TX_MOVE")).toBe(true)
  })

  it("single-wallet sync order can misclassify a move as spend, but never double-posts it", async () => {
    const m = mock()
    const client = clientFor(m.fetchImpl)
    const base = { userId: USER, savingsEnvelopeId: "env-savings", client, getPriceOnDate: () => 70000, saveTransaction: saveTransaction as never }

    // A is synced before B exists in the cache: the move looks like an external spend.
    await runSync({ ...base, wallet: walletA, otherWalletAddresses: await getUsedAddressesForOtherWallets(USER, walletA.id) })
    expect(saved.map((s) => `${s.type}:${s.notes}`)).toEqual([
      "credit:On-chain tx TX_FUND",
      "expense:On-chain tx TX_MOVE",
    ])

    // B then sees the same tx: user-level dedup prevents a second (credit) row.
    await runSync({ ...base, wallet: walletB, otherWalletAddresses: await getUsedAddressesForOtherWallets(USER, walletB.id) })
    expect(saved).toHaveLength(2)
    expect(await hasImportedTxid(USER, walletB.id, "TX_MOVE")).toBe(true)
  })

  it("refuses to import when the wallet has no spending envelope, before any network call", async () => {
    const m = mock()
    const orphan = { ...walletA, id: "wlt_orphan", defaultEnvelopeId: null }
    await expect(runSync({
      userId: USER, wallet: orphan, savingsEnvelopeId: "env-savings", client: clientFor(m.fetchImpl),
      getPriceOnDate: () => 1, saveTransaction: saveTransaction as never,
    })).rejects.toThrow(/Choose an envelope/)
    expect(m.calls).toHaveLength(0)
    // Scan-only passes are still allowed so the address cache can warm up.
    await expect(runSync({
      userId: USER, wallet: orphan, savingsEnvelopeId: "env-savings", client: clientFor(m.fetchImpl),
      getPriceOnDate: () => 1, saveTransaction: saveTransaction as never, importTransactions: false,
    })).resolves.toMatchObject({ txsImported: 0 })
  })
})

// ─── Privacy regression test ─────────────────────────────────────────

describe("runSync with a generic WatchSource (custody wallet shape)", () => {
  const saved: Array<{ source?: string; envelopeId: string; type: string; satsAmount?: number | null }> = []
  afterEach(() => { saved.length = 0 })

  const source: WatchSource = {
    id: "custody:wallet-1",
    nickname: "My BitBudget wallet",
    gapLimit: 3,
    defaultEnvelopeId: "env-spend",
    receiveMode: "envelope",
    explorerBaseUrl: "https://mempool.space/signet",
    ledgerSource: "onchain_wallet",
    deriveAddress: (chain, index) => `tb1p-fake-${chain}-${index}`,
  }

  it("scans via the supplied deriver and labels rows with the source's ledgerSource", async () => {
    const mock = buildMockEsplora({
      byAddressTxs: new Map<string, MockTx[]>([
        ["tb1p-fake-0-0", [{
          txid: "TX_CUSTODY_IN",
          vin: [{ addr: "external", value: 12_000 }],
          vout: [{ addr: "tb1p-fake-0-0", value: 12_000 }],
          blockTime: 1711929600,
          blockHeight: 100,
        }]],
      ]),
    })
    const client = new EsploraClient({ baseUrl: source.explorerBaseUrl, fetchImpl: mock.fetchImpl, minRequestSpacingMs: 0 })
    const res = await runSync({
      userId: USER,
      wallet: source,
      savingsEnvelopeId: "env-savings",
      client,
      getPriceOnDate: () => 60_000,
      saveTransaction: (async (t: typeof saved[number]) => { saved.push(t); return "srv_1" }) as never,
    })
    expect(res.txsImported).toBe(1)
    expect(saved[0]!.source).toBe("onchain_wallet")
    expect(saved[0]!.type).toBe("credit")
    // receiveMode "envelope" routes the receive to the wallet envelope, not Savings.
    expect(saved[0]!.envelopeId).toBe("env-spend")
    expect(saved[0]!.satsAmount).toBe(12_000)
    // Cache rows are namespaced by the source id, so custody and xpub wallets never collide.
    const rows = await getAddressesForWallet(USER, source.id)
    expect(rows.every((r) => r.walletId === "custody:wallet-1")).toBe(true)
    expect(mock.calls.every((u) => u.startsWith("https://mempool.space/signet/api/"))).toBe(true)
  })

  it("xpubWatchSource derives the same addresses as deriveAddress()", () => {
    const wallet = buildStoredWallet({ nickname: "x", xpub: ZPUB, kind: "bip84", explorerBaseUrl: "https://mempool.space", defaultEnvelopeId: "e", gapLimit: 5 })
    const ws = xpubWatchSource(wallet)
    expect(ws.ledgerSource).toBe("onchain_xpub")
    expect(ws.deriveAddress(0, 0)).toBe(ADDR_R0)
    expect(ws.deriveAddress(1, 0)).toBe(ADDR_C0)
  })
})

describe("PRIVACY: sync only contacts the configured explorer", () => {
  it("never sends the xpub or any derived address to BitBudget API or any other host", async () => {
    const wallet = buildStoredWallet({
      nickname: "Priv test",
      xpub: ZPUB,
      kind: "bip84",
      explorerBaseUrl: "https://mempool.space",
      gapLimit: 3,
      defaultEnvelopeId: "env-priv",
    })
    const mock = buildMockEsplora({
      byAddressTxs: new Map<string, MockTx[]>([
        [
          ADDR_R0,
          [
            {
              txid: "TX_X",
              vin: [{ addr: "external", value: 1000 }],
              vout: [{ addr: ADDR_R0, value: 1000 }],
              blockTime: 1711929600,
              blockHeight: 800050,
            },
          ],
        ],
      ]),
    })

    const apiCalls: string[] = []
    const apiSeenBodies: string[] = []
    const saveTransaction = async (txn: unknown) => {
      // Simulate what AppContext does: a POST to /api/transactions with the
      // payload. We capture the URL and the body.
      const body = JSON.stringify(txn)
      apiCalls.push("/api/transactions")
      apiSeenBodies.push(body)
      return "srv_id"
    }

    const client = new EsploraClient({
      baseUrl: wallet.explorerBaseUrl, fetchImpl: mock.fetchImpl, minRequestSpacingMs: 0,
    })
    await runSync({
      userId: USER, wallet, savingsEnvelopeId: "env-savings", client,
      getPriceOnDate: () => 70000, saveTransaction,
    })

    // 1) Every explorer-bound URL starts with the configured base URL.
    for (const url of mock.calls) {
      expect(url.startsWith(wallet.explorerBaseUrl + "/")).toBe(true)
    }

    // 2) None of the explorer URLs contain the xpub.
    for (const url of mock.calls) {
      expect(url).not.toContain(wallet.xpub)
    }

    // 3) None of the BitBudget API requests contain the xpub or any derived
    //    address. (txids are public and acceptable — they're stored encrypted
    //    on the server inside the encrypted notes field, but we still verify
    //    the *plaintext* payload body before encryption doesn't carry the xpub
    //    or the user's specific addresses.)
    const parsed = parseExtendedKey(wallet.xpub)
    const derived = [
      deriveAddress(parsed, 0, 0),
      deriveAddress(parsed, 0, 1),
      deriveAddress(parsed, 1, 0),
    ]
    for (const body of apiSeenBodies) {
      expect(body).not.toContain(wallet.xpub)
      for (const a of derived) {
        expect(body).not.toContain(a)
      }
    }

    // 4) We did call /api/transactions exactly once for the one importable tx.
    expect(apiCalls).toEqual(["/api/transactions"])
  })
})
