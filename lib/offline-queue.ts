/**
 * IndexedDB queue for transaction mutations while offline or when POST fails transiently.
 * Payloads are stored in cleartext locally (same trust boundary as txn-cache); encrypted on upload.
 */

import { openDB, type IDBPDatabase } from "idb"
import type { Transaction } from "@/lib/data"

const DB_PREFIX = "bitbudget-offline-"
const DB_VERSION = 1

export type PendingCreateMutation = {
  id: string
  kind: "create"
  clientTxnId: string
  body: Omit<Transaction, "id">
  enqueuedAt: string
}

export type PendingMutation = PendingCreateMutation

interface OfflineDB {
  queue: {
    key: string
    value: PendingMutation
    indexes: { enqueuedAt: string }
  }
}

function dbName(userId: string): string {
  return `${DB_PREFIX}${userId}`
}

export async function openOfflineDb(userId: string): Promise<IDBPDatabase<OfflineDB> | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return await openDB<OfflineDB>(dbName(userId), DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("queue")) {
          const store = db.createObjectStore("queue", { keyPath: "id" })
          store.createIndex("enqueuedAt", "enqueuedAt")
        }
      },
    })
  } catch {
    return null
  }
}

export async function enqueuePendingCreate(
  userId: string,
  clientTxnId: string,
  body: Omit<Transaction, "id">,
): Promise<void> {
  const db = await openOfflineDb(userId)
  if (!db) return
  const row: PendingCreateMutation = {
    id: `pending-${clientTxnId}`,
    kind: "create",
    clientTxnId,
    body,
    enqueuedAt: new Date().toISOString(),
  }
  await db.put("queue", row)
  await db.close()
}

export async function listPendingMutations(userId: string): Promise<PendingMutation[]> {
  const db = await openOfflineDb(userId)
  if (!db) return []
  const rows = await db.getAllFromIndex("queue", "enqueuedAt")
  await db.close()
  return rows
}

export async function removePendingMutation(userId: string, queueId: string): Promise<void> {
  const db = await openOfflineDb(userId)
  if (!db) return
  await db.delete("queue", queueId)
  await db.close()
}

export async function countPendingMutations(userId: string): Promise<number> {
  const db = await openOfflineDb(userId)
  if (!db) return 0
  const n = await db.count("queue")
  await db.close()
  return n
}

/** True when the browser reports offline or a fetch failed at the network layer. */
export function shouldQueueMutation(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  return err instanceof TypeError
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}
