/**
 * IndexedDB cache for xpub-derived state. Lives entirely on the client.
 *
 * Per-user database: `bitbudget-wallets-<userId>`.
 *
 * Object stores:
 *  - `addresses` — derived addresses per wallet, with usage info. Keyed by
 *    `walletId|chain|index`. We never need to look up by raw address from
 *    BitBudget code, so the address itself is the value, not the key.
 *  - `txids` — txids we have already imported into BitBudget transactions,
 *    keyed by `walletId|txid`. Used to skip already-imported txs across
 *    reloads / multi-device sync.
 *  - `meta` — per-wallet sync watermark, last block tip seen, etc.
 *
 * **No txid or address ever leaves the device through BitBudget's API.** This
 * cache exists *only* so the user does not pay the address-derivation +
 * explorer-scan cost on every page load.
 */

import { openDB, type IDBPDatabase } from "idb"

const DB_PREFIX = "bitbudget-wallets-"
const DB_VERSION = 1

export type AddressChain = 0 | 1 // 0 = external (receive), 1 = change

export interface CachedAddress {
  /** Composite key `walletId|chain|index`. */
  key: string
  walletId: string
  chain: AddressChain
  index: number
  address: string
  /** True once we've seen any tx for this address. Drives gap-limit decision. */
  used: boolean
  /** ISO timestamp of the most recent observed tx for this address, if any. */
  lastSeenAt: string | null
}

export interface CachedTxId {
  /** Composite key `walletId|txid`. */
  key: string
  walletId: string
  txid: string
  /**
   * Server-side BitBudget Transaction id created from this on-chain tx.
   * Populated after the API write succeeds; null while in flight.
   */
  bitbudgetTxnId: string | null
  /** Confirmation block height at import time, or null if mempool. */
  blockHeight: number | null
  importedAt: string
}

export interface WalletSyncMeta {
  /** Composite key `walletId`. */
  walletId: string
  lastSyncedAt: string | null
  /** Highest contiguous derived index per chain we have scanned. */
  externalScanHigh: number
  changeScanHigh: number
  /** Block tip height at the time of the last successful sync. */
  lastTipHeight: number | null
}

interface WalletsDb {
  addresses: {
    key: string
    value: CachedAddress
    indexes: { walletId: string }
  }
  txids: {
    key: string
    value: CachedTxId
    indexes: { walletId: string }
  }
  meta: {
    key: string
    value: WalletSyncMeta
  }
}

function dbName(userId: string): string {
  return `${DB_PREFIX}${userId}`
}

export function addressKey(walletId: string, chain: AddressChain, index: number): string {
  return `${walletId}|${chain}|${index}`
}

export function txidKey(walletId: string, txid: string): string {
  return `${walletId}|${txid}`
}

export async function openWalletDb(userId: string): Promise<IDBPDatabase<WalletsDb> | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return await openDB<WalletsDb>(dbName(userId), DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("addresses")) {
          const store = db.createObjectStore("addresses", { keyPath: "key" })
          store.createIndex("walletId", "walletId")
        }
        if (!db.objectStoreNames.contains("txids")) {
          const store = db.createObjectStore("txids", { keyPath: "key" })
          store.createIndex("walletId", "walletId")
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "walletId" })
        }
      },
    })
  } catch {
    return null
  }
}

export async function getMeta(userId: string, walletId: string): Promise<WalletSyncMeta | null> {
  const db = await openWalletDb(userId)
  if (!db) return null
  try {
    return (await db.get("meta", walletId)) ?? null
  } finally {
    db.close()
  }
}

export async function putMeta(userId: string, meta: WalletSyncMeta): Promise<void> {
  const db = await openWalletDb(userId)
  if (!db) return
  try {
    await db.put("meta", meta)
  } finally {
    db.close()
  }
}

export async function putAddresses(userId: string, addresses: CachedAddress[]): Promise<void> {
  if (addresses.length === 0) return
  const db = await openWalletDb(userId)
  if (!db) return
  try {
    const tx = db.transaction("addresses", "readwrite")
    await Promise.all([...addresses.map((a) => tx.store.put(a)), tx.done])
  } finally {
    db.close()
  }
}

export async function getAddressesForWallet(
  userId: string,
  walletId: string,
): Promise<CachedAddress[]> {
  const db = await openWalletDb(userId)
  if (!db) return []
  try {
    return await db.getAllFromIndex("addresses", "walletId", walletId)
  } finally {
    db.close()
  }
}

export async function hasImportedTxid(
  userId: string,
  walletId: string,
  txid: string,
): Promise<boolean> {
  const db = await openWalletDb(userId)
  if (!db) return false
  try {
    const row = await db.get("txids", txidKey(walletId, txid))
    return Boolean(row)
  } finally {
    db.close()
  }
}

export async function recordImportedTxid(
  userId: string,
  entry: Omit<CachedTxId, "key">,
): Promise<void> {
  const db = await openWalletDb(userId)
  if (!db) return
  try {
    await db.put("txids", { ...entry, key: txidKey(entry.walletId, entry.txid) })
  } finally {
    db.close()
  }
}

export async function getImportedTxidsForWallet(
  userId: string,
  walletId: string,
): Promise<CachedTxId[]> {
  const db = await openWalletDb(userId)
  if (!db) return []
  try {
    return await db.getAllFromIndex("txids", "walletId", walletId)
  } finally {
    db.close()
  }
}

export async function deleteWalletData(userId: string, walletId: string): Promise<void> {
  const db = await openWalletDb(userId)
  if (!db) return
  try {
    const tx = db.transaction(["addresses", "txids", "meta"], "readwrite")
    const addrIdx = tx.objectStore("addresses").index("walletId")
    let cursor = await addrIdx.openCursor(IDBKeyRange.only(walletId))
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    const txidIdx = tx.objectStore("txids").index("walletId")
    let txidCursor = await txidIdx.openCursor(IDBKeyRange.only(walletId))
    while (txidCursor) {
      await txidCursor.delete()
      txidCursor = await txidCursor.continue()
    }
    await tx.objectStore("meta").delete(walletId)
    await tx.done
  } finally {
    db.close()
  }
}

export async function clearWalletDb(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName(userId))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () =>
      reject(
        req.error ??
          new Error("IndexedDB delete blocked — close other BitBudget tabs and try again."),
      )
  })
}
