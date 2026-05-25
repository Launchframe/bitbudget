import { encryptFieldAsymmetric } from "@/lib/crypto"
import type { ApiTransactionRow } from "@/lib/txn-cache"
import {
  countPendingMutations,
  listPendingMutations,
  removePendingMutation,
  type PendingCreateMutation,
} from "@/lib/offline-queue"
import type { Transaction } from "@/lib/data"

export type FlushOfflineResult = {
  synced: number
  failed: number
  remaining: number
}

async function postCreateTransaction(
  body: Omit<Transaction, "id">,
  publicKey: Uint8Array | null,
): Promise<ApiTransactionRow | null> {
  const payload = { ...body }
  if (publicKey) {
    payload.payee = encryptFieldAsymmetric(body.payee, publicKey)
    if (payload.notes) payload.notes = encryptFieldAsymmetric(payload.notes, publicKey)
  }
  const res = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  return (await res.json()) as ApiTransactionRow
}

/**
 * Upload queued creates in order. Requires privacy key material for asymmetric encrypt when applicable.
 */
export async function flushOfflineQueue(opts: {
  userId: string
  publicKey: Uint8Array | null
  onSynced: (mutation: PendingCreateMutation, created: ApiTransactionRow) => Promise<void>
}): Promise<FlushOfflineResult> {
  const pending = await listPendingMutations(opts.userId)
  let synced = 0
  let failed = 0

  for (const row of pending) {
    if (row.kind !== "create") continue
    try {
      const created = await postCreateTransaction(row.body, opts.publicKey)
      if (!created) {
        failed += 1
        break
      }
      await opts.onSynced(row, created)
      await removePendingMutation(opts.userId, row.id)
      synced += 1
    } catch {
      failed += 1
      break
    }
  }

  const remaining = await countPendingMutations(opts.userId)
  return { synced, failed, remaining }
}
