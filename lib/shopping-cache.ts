/**
 * Encrypted shopping cache + offline check-off outbox.
 * Stores ciphertext only — never decrypted shopping content.
 */

import { openDB, type IDBPDatabase, deleteDB } from "idb"
import type { ShoppingOutboxItem } from "@/lib/shopping-sync"

const DB_PREFIX = "bitbudget-shopping-"
const DB_VERSION = 1

interface ShoppingCacheDB {
  snapshots: { key: string; value: { groupId: string; ciphertextBundle: string; updatedAt: string } }
  outbox: { key: string; value: ShoppingOutboxItem }
}

function dbName(userId: string): string {
  return `${DB_PREFIX}${userId}`
}

async function openShoppingDb(userId: string): Promise<IDBPDatabase<ShoppingCacheDB>> {
  return openDB<ShoppingCacheDB>(dbName(userId), DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "groupId" })
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" })
    },
  })
}

export async function saveShoppingSnapshot(
  userId: string,
  groupId: string,
  ciphertextBundle: string,
): Promise<void> {
  const db = await openShoppingDb(userId)
  try {
    await db.put("snapshots", { groupId, ciphertextBundle, updatedAt: new Date().toISOString() })
  } finally {
    db.close()
  }
}

export async function loadShoppingSnapshot(
  userId: string,
  groupId: string,
): Promise<string | null> {
  const db = await openShoppingDb(userId)
  try {
    const row = await db.get("snapshots", groupId)
    return row?.ciphertextBundle ?? null
  } finally {
    db.close()
  }
}

export async function enqueueShoppingOutbox(userId: string, item: ShoppingOutboxItem): Promise<void> {
  const db = await openShoppingDb(userId)
  try {
    await db.put("outbox", item)
  } finally {
    db.close()
  }
}

export async function listShoppingOutbox(userId: string): Promise<ShoppingOutboxItem[]> {
  const db = await openShoppingDb(userId)
  try {
    return (await db.getAll("outbox")).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
  } finally {
    db.close()
  }
}

export async function removeShoppingOutboxItem(userId: string, id: string): Promise<void> {
  const db = await openShoppingDb(userId)
  try {
    await db.delete("outbox", id)
  } finally {
    db.close()
  }
}

export async function clearShoppingCache(userId: string): Promise<void> {
  try {
    await deleteDB(dbName(userId))
  } catch {
    /* private mode / blocked */
  }
}
