/**
 * IndexedDB-backed cache for decrypted transaction payee/notes.
 * Per-user DB name; clear on logout.
 */

import { openDB, type IDBPDatabase } from "idb"
import { decryptFieldAsymmetric, looksLikeAsymmetricCiphertext } from "@/lib/crypto"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import type { Transaction, TransactionSource } from "@/lib/data"

export { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"

const DB_PREFIX = "bitbudget-txns-"
const DB_VERSION = 3
const META_LAST_SYNC = "lastSync"

/** Memo store keys for instant cold-start hints (JSON-serialized values). */
export const MEMO_KEYS = {
  txnCount: "memo_txnCount",
  topOCIds: "memo_topOCIds",
} as const

/** ISO calendar date `daysBack` days before today (UTC), YYYY-MM-DD. */
export function startDateForRecentWindow(daysBack: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().split("T")[0]!
}

/** Previous calendar day (UTC), for `endDate` on API / IDB split. */
export function dayBeforeIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().split("T")[0]!
}

/** Fields that use asymmetric encrypt/decrypt on the wire. */
export const SENSITIVE_FIELDS = { payee: true, notes: true } as const

export type SensitiveFieldName = keyof typeof SENSITIVE_FIELDS

export type CachedTransaction = Transaction & {
  isDecrypted: boolean
  serverPayee: string
  serverNotes: string | null
  updatedAt: string
}

/** Raw row from GET /api/transactions */
export type ApiTransactionRow = {
  id: string
  date: string
  payee: string
  amount: number
  type: Transaction["type"]
  envelopeId: string
  tags: string[]
  notes: string | null
  satsAmount: number | null
  recurringId: string | null
  source?: TransactionSource
  /** Present after API migration; callers may synthesize for older payloads. */
  updatedAt?: string
}

interface BitbudgetTxnDB {
  transactions: {
    key: string
    value: CachedTransaction
    indexes: { date: string; envelopeId: string }
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
  memos: {
    key: string
    value: { key: string; payload: string }
  }
}

function dbName(userId: string): string {
  return `${DB_PREFIX}${userId}`
}

export async function openTxnDb(userId: string): Promise<IDBPDatabase<BitbudgetTxnDB> | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return await openDB<BitbudgetTxnDB>(dbName(userId), DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains("transactions")) {
          const store = db.createObjectStore("transactions", { keyPath: "id" })
          store.createIndex("date", "date")
          store.createIndex("envelopeId", "envelopeId")
        } else if (oldVersion < 2) {
          const store = transaction.objectStore("transactions")
          if (!store.indexNames.contains("envelopeId")) {
            store.createIndex("envelopeId", "envelopeId")
          }
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" })
        }
        if (!db.objectStoreNames.contains("memos")) {
          db.createObjectStore("memos", { keyPath: "key" })
        }
      },
    })
  } catch {
    return null
  }
}

export async function getLastSyncIso(userId: string): Promise<string | null> {
  const db = await openTxnDb(userId)
  if (!db) return null
  try {
    const row = await db.get("meta", META_LAST_SYNC)
    return row?.value ?? null
  } finally {
    db.close()
  }
}

export async function setLastSyncIso(userId: string, iso: string | null): Promise<void> {
  const db = await openTxnDb(userId)
  if (!db) return
  try {
    if (iso == null) {
      await db.delete("meta", META_LAST_SYNC)
    } else {
      await db.put("meta", { key: META_LAST_SYNC, value: iso })
    }
  } finally {
    db.close()
  }
}

export async function isTxnIndexedDbAvailable(userId: string): Promise<boolean> {
  const db = await openTxnDb(userId)
  if (!db) return false
  db.close()
  return true
}

/** Full read of the transaction cache (e.g. after PIN unlock, delta merge). Prefer batched reads for cold start. */
export async function getAllCached(userId: string): Promise<CachedTransaction[]> {
  const db = await openTxnDb(userId)
  if (!db) return []
  try {
    return await db.getAll("transactions")
  } finally {
    db.close()
  }
}

/** Transactions with `date >= cutoff` (YYYY-MM-DD), newest first by `date` index. */
export async function getRecentCached(
  userId: string,
  daysBack: number,
): Promise<CachedTransaction[]> {
  const cutoff = startDateForRecentWindow(daysBack)
  const db = await openTxnDb(userId)
  if (!db) return []
  try {
    const tx = db.transaction("transactions", "readonly")
    const store = tx.store
    let result: CachedTransaction[]
    if (!store.indexNames.contains("date")) {
      const all = await store.getAll()
      result = all.filter((r) => r.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date))
    } else {
      const out: CachedTransaction[] = []
      let cursor = await store.index("date").openCursor(null, "prev")
      while (cursor) {
        const row = cursor.value as CachedTransaction
        if (row.date < cutoff) break
        out.push(row)
        cursor = await cursor.continue()
      }
      result = out
    }
    await tx.done
    return result
  } finally {
    db.close()
  }
}

/**
 * Transactions with `date < beforeDate` (YYYY-MM-DD), newest first by `date` index.
 *
 * Do not `setTimeout` / macrotask-yield inside this cursor loop: IndexedDB read-only
 * transactions auto-commit when the event loop runs with no pending requests; yielding
 * lets the transaction finish and the next `cursor.continue()` throws TransactionInactiveError.
 */
export async function getRemainingCached(
  userId: string,
  beforeDate: string,
): Promise<CachedTransaction[]> {
  const db = await openTxnDb(userId)
  if (!db) return []
  try {
    const tx = db.transaction("transactions", "readonly")
    const store = tx.store
    let result: CachedTransaction[]
    if (!store.indexNames.contains("date")) {
      const all = await store.getAll()
      const filtered = all.filter((r) => r.date < beforeDate)
      result = filtered.sort((a, b) => b.date.localeCompare(a.date))
    } else {
      const dateIndex = store.index("date")
      const range = IDBKeyRange.upperBound(beforeDate, true)
      const out: CachedTransaction[] = []
      let cursor = await dateIndex.openCursor(range, "prev")
      while (cursor) {
        out.push(cursor.value as CachedTransaction)
        cursor = await cursor.continue()
      }
      result = out
    }
    await tx.done
    return result
  } finally {
    db.close()
  }
}

export async function getCachedCount(userId: string): Promise<number> {
  const db = await openTxnDb(userId)
  if (!db) return 0
  try {
    return await db.count("transactions")
  } finally {
    db.close()
  }
}

export async function getCachedByIds(
  userId: string,
  ids: string[],
): Promise<CachedTransaction[]> {
  if (ids.length === 0) return []
  const db = await openTxnDb(userId)
  if (!db) return []
  try {
    const tx = db.transaction("transactions", "readonly")
    const store = tx.store
    const rows = await Promise.all(ids.map(id => store.get(id)))
    await tx.done
    return rows.filter((row): row is CachedTransaction => Boolean(row))
  } finally {
    db.close()
  }
}

export async function getMemo<T>(userId: string, memoKey: string): Promise<T | null> {
  const db = await openTxnDb(userId)
  if (!db) return null
  try {
    const row = await db.get("memos", memoKey)
    if (!row?.payload) return null
    try {
      return JSON.parse(row.payload) as T
    } catch {
      return null
    }
  } finally {
    db.close()
  }
}

export async function setMemo(userId: string, memoKey: string, value: unknown): Promise<void> {
  const db = await openTxnDb(userId)
  if (!db) return
  try {
    await db.put("memos", { key: memoKey, payload: JSON.stringify(value) })
  } finally {
    db.close()
  }
}

export async function putMany(userId: string, txns: CachedTransaction[]): Promise<void> {
  if (txns.length === 0) return
  const db = await openTxnDb(userId)
  if (!db) return
  try {
    const tx = db.transaction("transactions", "readwrite")
    await Promise.all([...txns.map((t) => tx.store.put(t)), tx.done])
  } finally {
    db.close()
  }
}

export async function removeMissing(userId: string, serverIds: Set<string>): Promise<void> {
  const db = await openTxnDb(userId)
  if (!db) return
  try {
    const keys = await db.getAllKeys("transactions")
    const tx = db.transaction("transactions", "readwrite")
    for (const id of keys) {
      if (typeof id !== "string") continue
      if (!serverIds.has(id)) await tx.store.delete(id)
    }
    await tx.done
  } finally {
    db.close()
  }
}

export async function deleteCachedTransaction(userId: string, id: string): Promise<void> {
  const db = await openTxnDb(userId)
  if (!db) return
  try {
    await db.delete("transactions", id)
  } finally {
    db.close()
  }
}

export async function removeCachedForEnvelope(userId: string, envelopeId: string): Promise<void> {
  const db = await openTxnDb(userId)
  if (!db) return
  try {
    const idbTx = db.transaction("transactions", "readwrite")
    const store = idbTx.store
    if (store.indexNames.contains("envelopeId")) {
      let cursor = await store.index("envelopeId").openCursor(IDBKeyRange.only(envelopeId))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
    } else {
      const all = await store.getAll()
      for (const t of all) {
        if (t.envelopeId === envelopeId) await store.delete(t.id)
      }
    }
    await idbTx.done
  } finally {
    db.close()
  }
}

export async function getUndecrypted(userId: string): Promise<CachedTransaction[]> {
  const all = await getAllCached(userId)
  return all.filter((t) => !t.isDecrypted)
}

export async function clearDb(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName(userId))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => {
      reject(
        req.error ??
          new Error(
            "IndexedDB delete is blocked (another tab may have the database open). Close other BitBudget tabs and try again.",
          ),
      )
    }
  })
}

function rowUpdatedAt(row: ApiTransactionRow): string {
  return row.updatedAt ?? `${row.date}T12:00:00.000Z`
}

export function apiRowToCachedLocked(row: ApiTransactionRow): CachedTransaction {
  return {
    id: row.id,
    date: row.date,
    payee: ENCRYPTED_DISPLAY,
    amount: row.amount,
    type: row.type,
    envelopeId: row.envelopeId,
    tags: row.tags,
    notes: row.notes ? ENCRYPTED_DISPLAY : null,
    satsAmount: row.satsAmount,
    recurringId: row.recurringId,
    source: row.source,
    updatedAt: rowUpdatedAt(row),
    isDecrypted: false,
    serverPayee: row.payee,
    serverNotes: row.notes,
  }
}

export function apiRowToCachedPlaintext(row: ApiTransactionRow): CachedTransaction {
  return {
    id: row.id,
    date: row.date,
    payee: row.payee,
    amount: row.amount,
    type: row.type,
    envelopeId: row.envelopeId,
    tags: row.tags,
    notes: row.notes,
    satsAmount: row.satsAmount,
    recurringId: row.recurringId,
    source: row.source,
    updatedAt: rowUpdatedAt(row),
    isDecrypted: true,
    serverPayee: row.payee,
    serverNotes: row.notes,
  }
}

/**
 * Decrypt payee/notes; on failure, mask only values that plausibly are sealed-box ciphertext
 * (see {@link looksLikeAsymmetricCiphertext} — wrong key vs legacy plaintext). IndexedDB
 * `isDecrypted` is set from this result, not a substitute for the decrypt-throw branch.
 */
function decryptSensitiveFields(
  row: ApiTransactionRow,
  secretKey: Uint8Array,
): Pick<CachedTransaction, "payee" | "notes" | "isDecrypted"> {
  let payee = row.payee
  let notes: string | null = row.notes
  try {
    payee = decryptFieldAsymmetric(row.payee, secretKey)
  } catch {
    if (looksLikeAsymmetricCiphertext(row.payee)) {
      return {
        payee: ENCRYPTED_DISPLAY,
        notes: row.notes && looksLikeAsymmetricCiphertext(row.notes) ? ENCRYPTED_DISPLAY : row.notes,
        isDecrypted: false,
      }
    }
    payee = row.payee
  }
  if (row.notes) {
    try {
      notes = decryptFieldAsymmetric(row.notes, secretKey)
    } catch {
      if (looksLikeAsymmetricCiphertext(row.notes)) {
        return { payee, notes: ENCRYPTED_DISPLAY, isDecrypted: false }
      }
      notes = row.notes
    }
  }
  return { payee, notes, isDecrypted: true }
}

export function decryptSingleCachedRow(row: ApiTransactionRow, secretKey: Uint8Array): CachedTransaction {
  const { payee, notes, isDecrypted } = decryptSensitiveFields(row, secretKey)
  return {
    id: row.id,
    date: row.date,
    payee,
    amount: row.amount,
    type: row.type,
    envelopeId: row.envelopeId,
    tags: row.tags,
    notes,
    satsAmount: row.satsAmount,
    recurringId: row.recurringId,
    source: row.source,
    updatedAt: rowUpdatedAt(row),
    isDecrypted,
    serverPayee: row.payee,
    serverNotes: row.notes,
  }
}

/**
 * Decrypt API rows in chunks, yielding to the main thread between chunks.
 */
export async function decryptBatch(
  rows: ApiTransactionRow[],
  secretKey: Uint8Array,
  chunkSize = 50,
): Promise<CachedTransaction[]> {
  const out: CachedTransaction[] = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize)
    for (const row of slice) {
      out.push(decryptSingleCachedRow(row, secretKey))
    }
    if (i + chunkSize < rows.length) {
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }
  return out
}

/** Strip cache-only fields for React state / API-shaped objects. */
export function cachedToClientTransaction(c: CachedTransaction): Transaction {
  const { serverPayee, serverNotes, ...rest } = c
  void serverPayee
  void serverNotes
  return rest
}

function isSortedDescByDate(txns: Transaction[]): boolean {
  for (let i = 1; i < txns.length; i++) {
    if (txns[i - 1]!.date < txns[i]!.date) return false
  }
  return true
}

/** Merge decrypted cache rows into existing client transactions (by id), sorted date desc. */
export function mergeTransactionBatch(
  prev: Transaction[],
  batch: CachedTransaction[],
): Transaction[] {
  const byId = new Map(prev.map((t) => [t.id, t]))
  let dateChanged = false
  const newInBatchOrder: Transaction[] = []

  for (const c of batch) {
    const clientTxn = cachedToClientTransaction(c)
    const existing = byId.get(c.id)
    if (existing) {
      if (existing.date !== clientTxn.date) dateChanged = true
    } else {
      newInBatchOrder.push(clientTxn)
    }
    byId.set(c.id, clientTxn)
  }

  const merged = Array.from(byId.values())
  if (merged.length <= 1) return merged

  let isPrevSortedDesc = true
  for (let i = 1; i < prev.length; i++) {
    if (prev[i - 1]!.date < prev[i]!.date) {
      isPrevSortedDesc = false
      break
    }
  }

  if (!isPrevSortedDesc || dateChanged) {
    return merged.sort((a, b) => b.date.localeCompare(a.date))
  }

  if (newInBatchOrder.length === 0) {
    return merged
  }

  if (prev.length === 0) {
    return merged.sort((a, b) => b.date.localeCompare(a.date))
  }

  const tailDate = prev[prev.length - 1]!.date
  const allNewNotAfterTail = newInBatchOrder.every((t) => t.date <= tailDate)
  if (allNewNotAfterTail && isSortedDescByDate(newInBatchOrder)) {
    return merged
  }

  return merged.sort((a, b) => b.date.localeCompare(a.date))
}

export function maxUpdatedAtIso(rows: CachedTransaction[]): string | null {
  if (rows.length === 0) return null
  let max = rows[0]!.updatedAt
  for (let i = 1; i < rows.length; i++) {
    const u = rows[i]!.updatedAt
    if (u > max) max = u
  }
  return max
}

/** Advance delta-sync cursor: max of previous high-water mark and new candidate (ISO strings sort lexicographically). */
export function mergeLastSyncIso(prev: string | null, candidate: string | null): string | null {
  if (!candidate) return prev
  if (!prev) return candidate
  return prev > candidate ? prev : candidate
}

function cachedUndecryptedToApiRow(c: CachedTransaction): ApiTransactionRow {
  return {
    id: c.id,
    date: c.date,
    payee: c.serverPayee,
    amount: c.amount,
    type: c.type,
    envelopeId: c.envelopeId,
    tags: c.tags,
    notes: c.serverNotes,
    satsAmount: c.satsAmount ?? null,
    recurringId: c.recurringId ?? null,
    source: c.source,
    updatedAt: c.updatedAt,
  }
}

/**
 * Decrypt rows that were stored ciphertext-only (locked session) and persist cleartext to IndexedDB.
 * Tradeoff: cleartext survives tab close until logout/clear cache; mitigations — we do not hydrate
 * from cache while the session is PIN-locked without a key, and `logout` deletes the DB.
 */
export async function decryptAndPersistUndecrypted(
  userId: string,
  secretKey: Uint8Array,
): Promise<CachedTransaction[]> {
  const undec = await getUndecrypted(userId)
  if (undec.length === 0) return []
  const apiRows = undec.map(cachedUndecryptedToApiRow)
  const decrypted = await decryptBatch(apiRows, secretKey)
  await putMany(userId, decrypted)
  return decrypted
}

export async function processApiTransactions(
  rows: ApiTransactionRow[],
  opts: { lockedSession: boolean; secretKey: Uint8Array | null },
): Promise<CachedTransaction[]> {
  const { lockedSession, secretKey } = opts
  if (lockedSession) return rows.map(apiRowToCachedLocked)
  if (secretKey) return decryptBatch(rows, secretKey)
  return rows.map(apiRowToCachedPlaintext)
}
