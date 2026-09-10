import { EsploraClient, type EsploraUtxo } from "@/lib/wallets/esplora-client"
import { getAddressesForWallet, getMeta, getUsedAddressesForOtherWallets, type CachedAddress } from "@/lib/wallets/xpub-cache"
import { runSync, type ProgressCallback, type RunSyncResult } from "@/lib/wallets/xpub-sync"
import type { Transaction } from "@/lib/data"
import type { StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import type { CustodyLedgerSettings } from "@/lib/wallet/ledger-settings"
import { custodyWatchId, openCustodyWatchSource } from "@/lib/wallet/watch-source"

/**
 * Browser-side sync for a BitBudget custody wallet. Reuses the xpub sync
 * engine through {@link openCustodyWatchSource}; nothing here touches shares,
 * passkeys, or the server. All network traffic goes to the user's explorer.
 */

export interface CustodyUtxo {
  txid: string
  vout: number
  valueSats: number
  address: string
  chain: 0 | 1
  index: number
  confirmed: boolean
  blockHeight: number | null
}

export interface CustodyBalance {
  confirmedSats: number
  pendingSats: number
  utxos: CustodyUtxo[]
  /** Addresses the explorer has seen activity on, by chain. */
  usedReceive: number
  usedChange: number
  fetchedAt: string
}

export interface SyncCustodyWalletInput {
  userId: string
  privacyKey: Uint8Array
  record: StoredWalletCustody
  nickname: string
  settings: CustodyLedgerSettings
  savingsEnvelopeId: string | null
  getPriceOnDate: (date: string) => number
  saveTransaction: (txn: Omit<Transaction, "id">) => Promise<string | null>
  onProgress?: ProgressCallback
  importTransactions?: boolean
  signal?: AbortSignal
}

export interface SyncCustodyWalletResult extends RunSyncResult {
  balance: CustodyBalance
}

function toUtxo(row: CachedAddress, u: EsploraUtxo): CustodyUtxo {
  return {
    txid: u.txid,
    vout: u.vout,
    valueSats: u.value,
    address: row.address,
    chain: row.chain,
    index: row.index,
    confirmed: u.status.confirmed === true,
    blockHeight: u.status.block_height ?? null,
  }
}

/** Fetch the current UTXO set for every cached used address of a custody wallet. */
export async function fetchCustodyBalance(input: {
  userId: string
  walletId: string
  client: EsploraClient
}): Promise<CustodyBalance> {
  const rows = await getAddressesForWallet(input.userId, custodyWatchId(input.walletId))
  const used = rows.filter((r) => r.used)
  const utxos: CustodyUtxo[] = []
  for (const row of used) {
    const list = await input.client.getAddressUtxos(row.address)
    for (const u of list) utxos.push(toUtxo(row, u))
  }
  let confirmedSats = 0
  let pendingSats = 0
  for (const u of utxos) {
    if (u.confirmed) confirmedSats += u.valueSats
    else pendingSats += u.valueSats
  }
  return {
    confirmedSats,
    pendingSats,
    utxos: utxos.sort((a, b) => b.valueSats - a.valueSats),
    usedReceive: used.filter((r) => r.chain === 0).length,
    usedChange: used.filter((r) => r.chain === 1).length,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * One sync pass: scan derived addresses, import ledger rows through the shared
 * engine, then refresh the UTXO-based balance. The watch seed is opened for the
 * duration of the pass only and zeroed in `finally`.
 */
export async function syncCustodyWallet(input: SyncCustodyWalletInput): Promise<SyncCustodyWalletResult> {
  const importTransactions = input.importTransactions ?? true
  if (importTransactions && !input.savingsEnvelopeId) {
    throw new Error("Your Savings envelope is still being set up. Try again in a moment.")
  }
  if (importTransactions && !input.settings.defaultEnvelopeId) {
    throw new Error("Choose an envelope for this wallet before syncing.")
  }
  const source = await openCustodyWatchSource({
    record: input.record,
    privacyKey: input.privacyKey,
    nickname: input.nickname,
    settings: input.settings,
  })
  try {
    const client = new EsploraClient({ baseUrl: input.settings.explorerBaseUrl, signal: input.signal })
    const meta = await getMeta(input.userId, source.id)
    const resumeFrom = meta
      ? {
          externalIndex: Math.max(0, meta.externalScanHigh - source.gapLimit),
          changeIndex: Math.max(0, meta.changeScanHigh - source.gapLimit),
        }
      : undefined
    const otherWalletAddresses = await getUsedAddressesForOtherWallets(input.userId, source.id)
    const result = await runSync({
      userId: input.userId,
      wallet: source,
      savingsEnvelopeId: input.savingsEnvelopeId ?? "",
      client,
      resumeFrom,
      otherWalletAddresses,
      importTransactions,
      getPriceOnDate: input.getPriceOnDate,
      saveTransaction: input.saveTransaction,
      onProgress: input.onProgress,
    })
    const balance = await fetchCustodyBalance({ userId: input.userId, walletId: input.record.identity.id, client })
    return { ...result, balance }
  } finally {
    source.dispose()
  }
}
