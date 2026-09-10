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
  getAddressesForWallet,
  hasImportedTxid,
  hasImportedTxidAnyWallet,
  putAddresses,
  putMeta,
  recordImportedTxid,
} from "@/lib/wallets/xpub-cache"
import { deriveAddress, parseExtendedKey } from "@/lib/wallets/xpub-derive"
import type { StoredWallet } from "@/lib/wallets/xpub-store"
import type { Transaction, TransactionSource } from "@/lib/data"

/**
 * Anything the sync engine can watch. A pasted xpub and a BitBudget custody
 * wallet both derive addresses deterministically; only the derivation and the
 * ledger `source` label differ. Everything downstream (gap-limit scan, cache,
 * classification, envelope routing) is shared.
 */
export interface WatchSource {
  /** Local-only id (xpub wallet id or custody wallet id). Never sent to the server. */
  id: string
  nickname: string
  gapLimit: number
  defaultEnvelopeId: string | null
  receiveMode: StoredWallet["receiveMode"]
  explorerBaseUrl: string
  /** `Transaction.source` for rows produced from this source. */
  ledgerSource: Extract<TransactionSource, "onchain_xpub" | "onchain_wallet">
  /** Derive the address at `chain`/`index`. Must be pure and deterministic. */
  deriveAddress(chain: AddressChain, index: number): string
}

/** Adapt a stored xpub wallet to the generic watch interface. */
export function xpubWatchSource(wallet: StoredWallet): WatchSource {
  const parsed = parseExtendedKey(wallet.xpub)
  if (parsed.kind !== wallet.kind) {
    throw new Error(
      `Wallet was saved as ${wallet.kind} but the xpub now parses as ${parsed.kind}; refusing to scan with mismatched kind.`,
    )
  }
  return {
    id: wallet.id,
    nickname: wallet.nickname,
    gapLimit: wallet.gapLimit,
    defaultEnvelopeId: wallet.defaultEnvelopeId,
    receiveMode: wallet.receiveMode,
    explorerBaseUrl: wallet.explorerBaseUrl,
    ledgerSource: "onchain_xpub",
    deriveAddress: (chain, index) => deriveAddress(parsed, chain, index),
  }
}

function isWatchSource(value: StoredWallet | WatchSource): value is WatchSource {
  return typeof (value as WatchSource).deriveAddress === "function"
}

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
  wallet: LedgerRoutingWallet
  /** System Savings envelope id — destination for credits when `receiveMode === "savings"`. */
  savingsEnvelopeId: string
  /** USD/BTC price at the tx date (used to convert sats → USD). */
  btcPriceOnDate: number
}

export type LedgerRoutingWallet = Pick<StoredWallet, "id" | "nickname" | "defaultEnvelopeId" | "receiveMode"> &
  Partial<Pick<WatchSource, "ledgerSource">>

/**
 * Which envelope an on-chain row lands in.
 *  - spends always debit the wallet's chosen envelope;
 *  - receives credit Savings (default) or the wallet's envelope, per `receiveMode`.
 * Throws when the wallet has no envelope chosen and one is required, so the
 * caller surfaces "choose an envelope" instead of guessing.
 */
export function resolveLedgerEnvelopeId(
  wallet: Pick<StoredWallet, "defaultEnvelopeId" | "receiveMode">,
  type: Transaction["type"],
  savingsEnvelopeId: string,
): string {
  if (type === "credit" && wallet.receiveMode === "savings") return savingsEnvelopeId
  if (!wallet.defaultEnvelopeId) {
    throw new Error("Choose an envelope for this wallet before syncing.")
  }
  return wallet.defaultEnvelopeId
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
  const type: Transaction["type"] = isCredit ? "credit" : "expense"
  return {
    date,
    payee: `Bitcoin: ${input.wallet.nickname}`,
    amount: usd,
    type,
    envelopeId: resolveLedgerEnvelopeId(input.wallet, type, input.savingsEnvelopeId),
    tags: [],
    notes: `On-chain tx ${input.txid}`,
    satsAmount: sats,
    source: input.wallet.ledgerSource ?? "onchain_xpub",
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
  source: WatchSource,
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
    const address = source.deriveAddress(chain, i)
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
      let txs: EsploraTx[]
      try {
        txs = await client.getAddressTxs(address)
      } catch (err) {
      throw new Error(
        `Explorer tx query failed at chain ${chain} index ${i}: ${(err as Error).message}`,
      )
      }
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

/**
 * Re-fetch txs for previously scanned used addresses outside the current gap
 * window so incremental sync picks up new activity on old receive/change addrs.
 */
async function refreshCachedUsedAddressTxs(
  previouslyCached: CachedAddress[],
  collected: CachedAddress[],
  client: EsploraClient,
  txMap: Map<string, EsploraTx>,
): Promise<void> {
  const collectedKeys = new Set(collected.map((c) => c.key))
  for (const row of previouslyCached) {
    if (!row.used || collectedKeys.has(row.key)) continue
    let txs: EsploraTx[]
    try {
      txs = await client.getAddressTxs(row.address)
    } catch (err) {
      throw new Error(
        `Explorer tx refresh failed for chain ${row.chain} index ${row.index}: ${(err as Error).message}`,
      )
    }
    for (const tx of txs) {
      if (!txMap.has(tx.txid)) txMap.set(tx.txid, tx)
    }
  }
}

function buildMyAddressSet(
  collected: CachedAddress[],
  previouslyCached: CachedAddress[],
): Set<string> {
  const out = new Set<string>()
  for (const row of collected) {
    if (row.used) out.add(row.address)
  }
  for (const row of previouslyCached) {
    if (row.used) out.add(row.address)
  }
  return out
}

export interface RunSyncOptions {
  userId: string
  /** A stored xpub wallet, or any {@link WatchSource} (e.g. a BitBudget custody wallet). */
  wallet: StoredWallet | WatchSource
  /** System Savings envelope id; receives land here when `wallet.receiveMode === "savings"`. */
  savingsEnvelopeId: string
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
  /**
   * Used addresses belonging to the user's *other* watched wallets. Treated as
   * "mine" during classification so transfers between the user's own wallets
   * net out as self-transfers. Typically `getUsedAddressesForOtherWallets()`.
   */
  otherWalletAddresses?: ReadonlySet<string>
  /**
   * When `false`, scan and cache addresses but do not classify or write ledger
   * rows. Used as the first pass of "Sync all" so every wallet's addresses are
   * known before any wallet classifies its transactions.
   */
  importTransactions?: boolean
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
  const { userId, client, savingsEnvelopeId, saveTransaction, onProgress } = opts
  const importTransactions = opts.importTransactions ?? true
  if (importTransactions && !opts.wallet.defaultEnvelopeId) {
    // Fail before any network call: the user must pick where spends go.
    throw new Error("Choose an envelope for this wallet before syncing.")
  }
  const wallet: WatchSource = isWatchSource(opts.wallet) ? opts.wallet : xpubWatchSource(opts.wallet)

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
    wallet, 0, wallet.gapLimit, client, externalStart, collected, txMap, wallet.id, tick,
  )
  const changeScanHigh = await scanChain(
    wallet, 1, wallet.gapLimit, client, changeStart, collected, txMap, wallet.id, tick,
  )

  const previouslyCached = await getAddressesForWallet(userId, wallet.id)
  await refreshCachedUsedAddressTxs(previouslyCached, collected, client, txMap)
  const myAddresses = buildMyAddressSet(collected, previouslyCached)
  for (const address of opts.otherWalletAddresses ?? []) myAddresses.add(address)

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

  if (!importTransactions) {
    onProgress?.({ walletId: wallet.id, scannedAddresses: scanned, txsFound: txMap.size, txsImported: 0, phase: "done" })
    return { scannedAddresses: scanned, txsFound: txMap.size, txsImported: 0, externalScanHigh, changeScanHigh, tipHeight }
  }

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
    // Another of the user's wallets already produced (or deliberately skipped)
    // this tx. Record it for this wallet too so removal cleanup stays scoped,
    // but never write a second ledger row.
    if (await hasImportedTxidAnyWallet(userId, tx.txid)) {
      await recordImportedTxid(userId, {
        walletId: wallet.id,
        txid: tx.txid,
        bitbudgetTxnId: null,
        blockHeight: tx.status.block_height ?? null,
        importedAt: new Date().toISOString(),
      } satisfies Omit<CachedTxId, "key">)
      continue
    }
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

    const blockHeight = tx.status.block_height
    if (blockHeight == null) {
      // Do not coerce a missing confirmed block height to 0 (genesis).
      // Leave un-recorded so a later sync can retry with complete metadata.
      continue
    }
    const date = unixSecondsToIsoDate(tx.status.block_time!)
    const price = opts.getPriceOnDate(date)
    const payload = buildTransactionPayload({
      netSats: net,
      blockTime: tx.status.block_time!,
      txid: tx.txid,
      blockHeight,
      wallet,
      savingsEnvelopeId,
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
    if (!serverId) {
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
