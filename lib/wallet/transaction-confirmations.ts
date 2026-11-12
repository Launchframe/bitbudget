import { isBitcoinLineage, isBitcoinNetwork, isChainTip, isHash256, isNonnegativeSafeInteger, sameChainTip } from "@/lib/wallet/types"
import type { BitcoinLineage, ChainSnapshot, ChainSnapshots, TransactionChainStatus } from "@/lib/wallet/types"

export type ConfirmationCount =
  | { readonly status: "known"; readonly count: number }
  | { readonly status: "unknown"; readonly count: null; readonly reason: "missing-or-stale" | "chain-mismatch" | "noncanonical" | "invalid-block" }

export function transactionConfirmations(
  transaction: TransactionChainStatus | null | undefined,
  snapshot: ChainSnapshot | null | undefined,
): ConfirmationCount {
  if (!transaction || !snapshot || snapshot.status !== "fresh" || !isChainTip(snapshot.tip)) {
    return { status: "unknown", count: null, reason: "missing-or-stale" }
  }
  if (!isBitcoinNetwork(transaction.network) || !isBitcoinLineage(transaction.lineage) || transaction.network !== snapshot.network || transaction.lineage !== snapshot.lineage || !sameChainTip(transaction.observedTip, snapshot.tip)) {
    return { status: "unknown", count: null, reason: "chain-mismatch" }
  }
  if (transaction.canonical === "mempool" && transaction.blockHeight === undefined && transaction.blockHash === undefined) {
    return { status: "known", count: 0 }
  }
  if (transaction.canonical !== "confirmed") return { status: "unknown", count: null, reason: "noncanonical" }
  const height = transaction.blockHeight
  if (!isNonnegativeSafeInteger(height) || !isHash256(transaction.blockHash) || height > snapshot.tip.height || (height === snapshot.tip.height && transaction.blockHash.toLowerCase() !== snapshot.tip.hash.toLowerCase())) {
    return { status: "unknown", count: null, reason: "invalid-block" }
  }
  const count = snapshot.tip.height - height + 1
  if (!Number.isSafeInteger(count)) return { status: "unknown", count: null, reason: "invalid-block" }
  return { status: "known", count }
}

export function confirmationsByLineage(
  transactions: Readonly<Partial<Record<BitcoinLineage, TransactionChainStatus>>>,
  snapshots: ChainSnapshots,
): Record<BitcoinLineage, ConfirmationCount> {
  const evaluate = (lineage: BitcoinLineage): ConfirmationCount => {
    if (transactions[lineage]?.lineage !== lineage || snapshots[lineage]?.lineage !== lineage) {
      return { status: "unknown", count: null, reason: "chain-mismatch" }
    }
    return transactionConfirmations(transactions[lineage], snapshots[lineage])
  }
  return { sha256d: evaluate("sha256d"), blake2b: evaluate("blake2b") }
}
