import { transactionConfirmations } from "@/lib/wallet/transaction-confirmations"
import { hexToBytes, bytesToHex } from "@/lib/wallet/public-data-tools"
import { isBitcoinLineage, isBitcoinNetwork, isChainTip, outpointKey } from "@/lib/wallet/types"
import type { BitcoinLineage, ChainSnapshots, WalletIdentity, WalletUtxo } from "@/lib/wallet/types"

export interface LineageBalance {
  readonly status: "complete" | "partial" | "conflict"
  readonly totalSats: bigint | null
  readonly knownConfirmedSats: bigint
  readonly knownPendingSats: bigint
  readonly unknownOutpoints: readonly string[]
  readonly conflictingOutpoints: readonly string[]
}

function fingerprint(utxo: WalletUtxo): string {
  const status = utxo.confirmation
  return JSON.stringify([
    utxo.valueSats.toString(), bytesToHex(hexToBytes(utxo.scriptPubKeyHex)), utxo.availability,
    status?.network, status?.lineage, status?.canonical, status?.blockHeight, status?.blockHash?.toLowerCase(),
    status?.observedTip?.height, status?.observedTip?.hash?.toLowerCase(), status?.observedTip?.medianTimePast,
  ])
}

export function walletBalances(
  wallet: WalletIdentity,
  utxos: readonly WalletUtxo[],
  snapshots: ChainSnapshots,
): Record<BitcoinLineage, LineageBalance> {
  if (!isBitcoinNetwork(wallet.network)) throw new Error("Invalid wallet network")
  for (const utxo of utxos) {
    if (!isBitcoinNetwork(utxo.network) || !isBitcoinLineage(utxo.lineage) || typeof utxo.valueSats !== "bigint" || utxo.valueSats < BigInt(0)) throw new Error("Invalid wallet output")
    outpointKey(utxo.outpoint)
    hexToBytes(utxo.scriptPubKeyHex)
  }
  const evaluate = (lineage: BitcoinLineage): LineageBalance => {
    const snapshot = snapshots[lineage]
    let partial = !snapshot || snapshot.status !== "fresh" || snapshot.network !== wallet.network || snapshot.lineage !== lineage || !isChainTip(snapshot.tip)
    const groups = new Map<string, WalletUtxo[]>()
    for (const utxo of utxos) {
      if (utxo.network !== wallet.network || utxo.lineage !== lineage) continue
      const key = outpointKey(utxo.outpoint)
      const group = groups.get(key)
      if (group) group.push(utxo)
      else groups.set(key, [utxo])
    }
    let knownConfirmedSats = BigInt(0)
    let knownPendingSats = BigInt(0)
    const unknownOutpoints: string[] = []
    const conflictingOutpoints: string[] = []
    for (const [key, rows] of groups) {
      const first = rows[0]
      const firstFingerprint = fingerprint(first)
      if (rows.some(row => fingerprint(row) !== firstFingerprint)) {
        conflictingOutpoints.push(key)
        continue
      }
      const confirmation = transactionConfirmations(first.confirmation, snapshot)
      if (confirmation.status === "unknown" || first.confirmation.network !== wallet.network || first.confirmation.lineage !== lineage || (first.availability !== "unspent" && first.availability !== "spent")) {
        partial = true
        unknownOutpoints.push(key)
        continue
      }
      if (first.availability === "spent") continue
      if (confirmation.count > 0) knownConfirmedSats += first.valueSats
      else knownPendingSats += first.valueSats
    }
    const status = conflictingOutpoints.length ? "conflict" : partial ? "partial" : "complete"
    return {
      status,
      totalSats: status === "complete" ? knownConfirmedSats + knownPendingSats : null,
      knownConfirmedSats,
      knownPendingSats,
      unknownOutpoints: unknownOutpoints.sort(),
      conflictingOutpoints: conflictingOutpoints.sort(),
    }
  }
  return { sha256d: evaluate("sha256d"), blake2b: evaluate("blake2b") }
}
