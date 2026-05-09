/**
 * xpub sync orchestrator. Pure logic: derive → scan → classify → return
 * proposed BitBudget transactions. The caller (AppContext glue / Settings UI)
 * is responsible for actually persisting them through `addTransaction` so the
 * existing client-side asymmetric encryption path applies before any byte
 * touches the server.
 *
 * **Privacy contract (enforced by tests):**
 * - The only outbound network calls in this module are made through the
 *   injected {@link EsploraClient}, which only ever talks to the user's
 *   configured `baseUrl`.
 * - Nothing here writes to BitBudget's API; it returns plaintext payloads
 *   that the caller encrypts.
 * - No xpub, derived address, or txid is ever logged.
 */

import {
  type EsploraAddressInfo,
  EsploraClient,
  type EsploraTx,
} from "@/lib/wallets/esplora-client"
import {
  type AddressChain,
  type CachedAddress,
  type CachedTxId,
  addressKey,
  hasImportedTxid,
  putAddresses,
  putMeta,
  recordImportedTxid,
} from "@/lib/wallets/xpub-cache"
import { deriveAddress, parseExtendedKey } from "@/lib/wallets/xpub-derive"
import type { StoredWallet } from "@/lib/wallets/xpub-store"
import type { Transaction } from "@/lib/data"

export interface SyncProgress {
  walletId: string
  scannedAddresses: number
  txsFound: number
  txsImported: number
  phase: "deriving" | "scanning" | "building" | "writing" | "done" | "error"
}

export type ProgressCallback = (p: SyncProgress) => void

export interface BuildPayloadInput {
  /** Net wallet delta in sats. >0 = credit, <0 = expense. */
  netSats: number
  /** Tx confirmation timestamp (UNIX seconds). */
  blockTime: number
  /** Tx hash. */
  txid: string
  /** Block height of confirmation. */
  blockHeight: number
  /** Wallet metadata for payee labeling and envelope routing. */
  wallet: Pick<StoredWallet, "id" | "nickname" | "defaultEnvelopeId">
  /** Fallback envelope id when wallet has no default. */
  fallbackEnvelopeId: string
  /** USD/BTC price at the tx date (used to convert sats → USD). */
  btcPriceOnDate: number
}

export interface BuildPayloadResult extends Omit<Transaction, "id"> {
  /** Surfaced separately so the dedup cache can record blockHeight even if writes fail. */
  txid: string
  blockHeight: number
}

/** Convert UNIX seconds to YYYY-MM-DD UTC. */
export function unixSecondsToIsoDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid block_time: ${unixSeconds}`)
  return d.toISOString().split("T")[0]!
}

const SATS_PER_BTC = 100_000_000

/**
 * Build a BitBudget transaction payload from a net wallet delta. Pure function;
 * unit-testable. Self-transfers (net === 0) should not call this — they are
 * filtered upstream.
 */
export function buildTransactionPayload(input: BuildPayloadInput): BuildPayloadResult {
  if (input.netSats === 0) {
    throw new Error("Cannot build a transaction for a zero-delta tx (self-transfer)")
  }
  const sats = Math.abs(input.netSats)
  const btc = sats / SATS_PER_BTC
  const usd = btc * input.btcPriceOnDate
  const date = unixSecondsToIsoDate(input.blockTime)
  const isCredit = input.netSats > 0
  return {
    date,
    payee: `Bitcoin: ${input.wallet.nickname}`,
    amount: usd,
    type: isCredit ? "credit" : "expense",
    envelopeId: input.wallet.defaultEnvelopeId ?? input.fallbackEnvelopeId,
    tags: [],
    notes: `On-chain tx ${input.txid}`,
    satsAmount: sats,
    source: "onchain_xpub",
    txid: input.txid,
    blockHeight: input.blockHeight,
  }
}

/**
 * Sum the net change to the wallet for a single tx. Returns sats.
 *  - vout entries paying my addresses are inflows
 *  - vin entries spending my prevouts are outflows
 *
 * Returns the net delta (positive = credit, negative = expense, 0 = self-transfer
 * such as consolidation: every input and output is mine and the wallet only
 * loses the network fee).
 */
export function netSatsForTx(tx: EsploraTx, myAddresses: Set<string>): number {
  let inflow = 0
  let outflow = 0
  for (const vout of tx.vout) {
    if (vout.scriptpubkey_address && myAddresses.has(vout.scriptpubkey_address)) {
      inflow += vout.value
    }
  }
  for (const vin of tx.vin) {
    const prev = vin.prevout
    if (prev && prev.scriptpubkey_address && myAddresses.has(prev.scriptpubkey_address)) {
      outflow += prev.value
    }
  }
  return inflow - outflow
}

/** True when every input and every output of `tx` is one of my addresses. */
export function isPureSelfTransfer(tx: EsploraTx, myAddresses: Set<string>): boolean {
  if (tx.vin.length === 0 || tx.vout.length === 0) return false
  for (const vin of tx.vin) {
    const a = vin.prevout?.scriptpubkey_address
    if (!a || !myAddresses.has(a)) return false
  }
  for (const vout of tx.vout) {
    const a = vout.scriptpubkey_address
    if (!a || !myAddresses.has(a)) return false
  }
  return true
}

/**
 * Walk a single chain (0 or 1) until `gapLimit` consecutive unused addresses
 * are seen. Updates `txMap` in place with any txs observed.
 */
async function scanChain(
  parsed: ReturnType<typeof parseExtendedKey>,
  chain: AddressChain,
  gapLimit: number,
  client: EsploraClient,
  startIndex: number,
  collected: CachedAddress[],
  txMap: Map<string, EsploraTx>,
  walletId: string,
  onScannedOne: () => void,
): Promise<number> {
  let consecutiveUnused = 0
  let i = startIndex
  while (consecutiveUnused < gapLimit) {
    const address = deriveAddress(parsed, chain, i)
    let info: EsploraAddressInfo
    try {
      info = await client.getAddressInfo(address)
    } catch (err) {
      throw new Error(
        `Explorer query failed at chain ${chain} index ${i}: ${(err as Error).message}`,
      )
    }
    const usedCount =
      info.chain_stats.tx_count + info.mempool_stats.tx_count
    const used = usedCount > 0
    let lastSeenAt: string | null = null
    if (used) {
      const txs = await client.getAddressTxs(address)
      for (const tx of txs) {
        if (!txMap.has(tx.txid)) txMap.set(tx.txid, tx)
        if (tx.status.confirmed && tx.status.block_time) {
          const iso = new Date(tx.status.block_time * 1000).toISOString()
          if (!lastSeenAt || iso > lastSeenAt) lastSeenAt = iso
        }
      }
      consecutiveUnused = 0
    } else {
      consecutiveUnused++
    }
    collected.push({
      key: addressKey(walletId, chain, i),
      walletId,
      chain,
      index: i,
      address,
      used,
      lastSeenAt,
    })
    onScannedOne()
    i++
  }
  return i
}

export interface RunSyncOptions {
  userId: string
  wallet: StoredWallet
  fallbackEnvelopeId: string
  /** Esplora client built against the user-configured `wallet.explorerBaseUrl`. */
  client: EsploraClient
  /** USD price for a given YYYY-MM-DD; typically `useBtcPrices().getPriceOnDate`. */
  getPriceOnDate: (date: string) => number
  /** Persist a single transaction; returns the server-created id. Provided by AppContext. */
  saveTransaction: (txn: Omit<Transaction, "id"> & { txid?: string }) => Promise<string | null>
  /** Optional progress callback. */
  onProgress?: ProgressCallback
  /** Where to resume scanning (defaults to 0/0 — full backfill on first run). */
  resumeFrom?: { externalIndex: number; changeIndex: number } | null
}

export interface RunSyncResult {
  scannedAddresses: number
  txsFound: number
  txsImported: number
  externalScanHigh: number
  changeScanHigh: number
  tipHeight: number | null
}

/**
 * One full sync pass for a single wallet. Idempotent: re-running with the
 * same cache state will skip already-imported txids.
 */
export async function runSync(opts: RunSyncOptions): Promise<RunSyncResult> {
  const { userId, wallet, client, fallbackEnvelopeId, saveTransaction, onProgress } = opts
  const parsed = parseExtendedKey(wallet.xpub)
  if (parsed.kind !== wallet.kind) {
    throw new Error(
      `Wallet was saved as ${wallet.kind} but the xpub now parses as ${parsed.kind}; refusing to scan with mismatched kind.`,
    )
  }

  const collected: CachedAddress[] = []
  const txMap = new Map<string, EsploraTx>()
  let scanned = 0
  const tick = () => {
    scanned++
    onProgress?.({
      walletId: wallet.id,
      scannedAddresses: scanned,
      txsFound: txMap.size,
      txsImported: 0,
      phase: "scanning",
    })
  }

  onProgress?.({ walletId: wallet.id, scannedAddresses: 0, txsFound: 0, txsImported: 0, phase: "deriving" })

  const externalStart = opts.resumeFrom?.externalIndex ?? 0
  const changeStart = opts.resumeFrom?.changeIndex ?? 0

  const externalScanHigh = await scanChain(
    parsed, 0, wallet.gapLimit, client, externalStart, collected, txMap, wallet.id, tick,
  )
  const changeScanHigh = await scanChain(
    parsed, 1, wallet.gapLimit, client, changeStart, collected, txMap, wallet.id, tick,
  )

  const myAddresses = new Set(collected.filter((c) => c.used).map((c) => c.address))

  let tipHeight: number | null = null
  try {
    tipHeight = await client.getTipHeight()
  } catch {
    /* tip height is non-critical; continue */
  }

  await putAddresses(userId, collected)
  await putMeta(userId, {
    walletId: wallet.id,
    lastSyncedAt: new Date().toISOString(),
    externalScanHigh,
    changeScanHigh,
    lastTipHeight: tipHeight,
  })

  onProgress?.({
    walletId: wallet.id,
    scannedAddresses: scanned,
    txsFound: txMap.size,
    txsImported: 0,
    phase: "building",
  })

  const txs = Array.from(txMap.values())
    .filter((t) => t.status.confirmed && typeof t.status.block_time === "number")
    .sort((a, b) => (a.status.block_time! - b.status.block_time!))

  let imported = 0
  for (const tx of txs) {
    if (await hasImportedTxid(userId, wallet.id, tx.txid)) continue
    // Pure self-transfers (consolidation, change-only) are recorded as
    // imported so we don't reconsider them, but no BitBudget transaction is
    // created. The wallet only loses the network fee in these cases; v1
    // intentionally does not surface that as spending. Note that we use
    // isPureSelfTransfer rather than `net === 0`: net is `-fee` here, not 0.
    if (isPureSelfTransfer(tx, myAddresses)) {
      await recordImportedTxid(userId, {
        walletId: wallet.id,
        txid: tx.txid,
        bitbudgetTxnId: null,
        blockHeight: tx.status.block_height ?? null,
        importedAt: new Date().toISOString(),
      } satisfies Omit<CachedTxId, "key">)
      continue
    }
    const net = netSatsForTx(tx, myAddresses)
    if (net === 0) {
      // Defensive: every input and every output is mine but the math zeroed
      // (e.g. a malformed mock or a degenerate edge case). Treat as self-tx.
      await recordImportedTxid(userId, {
        walletId: wallet.id,
        txid: tx.txid,
        bitbudgetTxnId: null,
        blockHeight: tx.status.block_height ?? null,
        importedAt: new Date().toISOString(),
      } satisfies Omit<CachedTxId, "key">)
      continue
    }

    const date = unixSecondsToIsoDate(tx.status.block_time!)
    const price = opts.getPriceOnDate(date)
    const payload = buildTransactionPayload({
      netSats: net,
      blockTime: tx.status.block_time!,
      txid: tx.txid,
      blockHeight: tx.status.block_height ?? 0,
      wallet,
      fallbackEnvelopeId,
      btcPriceOnDate: price,
    })

    const { txid: _omit1, blockHeight: _omit2, ...txnForApi } = payload
    void _omit1; void _omit2
    let serverId: string | null = null
    try {
      serverId = await saveTransaction(txnForApi)
    } catch {
      // Leave un-recorded so the next sync retries; do not poison the cache.
      continue
    }

    await recordImportedTxid(userId, {
      walletId: wallet.id,
      txid: tx.txid,
      bitbudgetTxnId: serverId,
      blockHeight: tx.status.block_height ?? null,
      importedAt: new Date().toISOString(),
    } satisfies Omit<CachedTxId, "key">)
    imported++

    onProgress?.({
      walletId: wallet.id,
      scannedAddresses: scanned,
      txsFound: txMap.size,
      txsImported: imported,
      phase: "writing",
    })
  }

  onProgress?.({
    walletId: wallet.id,
    scannedAddresses: scanned,
    txsFound: txMap.size,
    txsImported: imported,
    phase: "done",
  })

  return {
    scannedAddresses: scanned,
    txsFound: txMap.size,
    txsImported: imported,
    externalScanHigh,
    changeScanHigh,
    tipHeight,
  }
}
