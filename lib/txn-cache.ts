/**
 * IndexedDB-backed cache for decrypted transaction payee/notes.
 * Per-user DB name; clear on logout.
 */

import { openDB, type IDBPDatabase } from "idb"
import { decryptFieldAsymmetric } from "@/lib/crypto"
import type { Transaction, TransactionSource } from "@/lib/data"

const DB_PREFIX = "bitbudget-txns-"
const DB_VERSION = 1
const META_LAST_SYNC = "lastSync"

/** Fields that use asymmetric encrypt/decrypt on the wire. */
export const SENSITIVE_FIELDS = { payee: true, notes: true } as const

export type SensitiveFieldName = keyof typeof SENSITIVE_FIELDS

export const ENCRYPTED_DISPLAY = "(encrypted)"

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
    indexes: { date: string }
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
}

function dbName(userId: string): string {
  return `${DB_PREFIX}${userId}`
}

export async function openTxnDb(userId: string): Promise<IDBPDatabase<BitbudgetTxnDB> | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return await openDB<BitbudgetTxnDB>(dbName(userId), DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("transactions")) {
          const store = db.createObjectStore("transactions", { keyPath: "id" })
          store.createIndex("date", "date")
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" })
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

export async function getAllCached(userId: string): Promise<CachedTransaction[]> {
  const db = await openTxnDb(userId)
  if (!db) return []
  try {
    return await db.getAll("transactions")
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
    const all = await db.getAll("transactions")
    const tx = db.transaction("transactions", "readwrite")
    for (const t of all) {
      if (t.envelopeId === envelopeId) await tx.store.delete(t.id)
    }
    await tx.done
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
    req.onblocked = () => resolve()
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

function decryptSensitiveFields(
  row: ApiTransactionRow,
  secretKey: Uint8Array,
): Pick<CachedTransaction, "payee" | "notes" | "isDecrypted"> {
  let payee = row.payee
  let notes: string | null = row.notes
  try {
    payee = decryptFieldAsymmetric(row.payee, secretKey)
  } catch {
    return {
      payee: ENCRYPTED_DISPLAY,
      notes: row.notes ? ENCRYPTED_DISPLAY : null,
      isDecrypted: false,
    }
  }
  if (row.notes) {
    try {
      notes = decryptFieldAsymmetric(row.notes, secretKey)
    } catch {
      return { payee, notes: ENCRYPTED_DISPLAY, isDecrypted: false }
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

export function maxUpdatedAtIso(rows: CachedTransaction[]): string | null {
  if (rows.length === 0) return null
  let max = rows[0]!.updatedAt
  for (let i = 1; i < rows.length; i++) {
    const u = rows[i]!.updatedAt
    if (u > max) max = u
  }
  return max
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

/** Decrypt rows that were stored ciphertext-only (locked session); persist cleartext to IndexedDB. */
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
