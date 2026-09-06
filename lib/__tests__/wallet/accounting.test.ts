import { describe, expect, it } from "vitest"
import { transactionConfirmations, confirmationsByLineage } from "@/lib/wallet/transaction-confirmations"
import { walletBalances } from "@/lib/wallet/wallet-balances"
import { createWalletIdentity } from "@/lib/wallet/types"
import type { ChainSnapshot, TransactionChainStatus, WalletUtxo } from "@/lib/wallet/types"

const tip = { height: 110, hash: "ab".repeat(32), medianTimePast: 1700000000 }
const snapshot: ChainSnapshot = { network: "mainnet", lineage: "sha256d", status: "fresh", tip, profileId: "profile-1" }
const status: TransactionChainStatus = { network: "mainnet", lineage: "sha256d", canonical: "confirmed", blockHeight: 100, blockHash: "cd".repeat(32), observedTip: tip }
const utxo: WalletUtxo = { network: "mainnet", lineage: "sha256d", outpoint: { txid: "ef".repeat(32), vout: 0 }, valueSats: BigInt(12), scriptPubKeyHex: "51", availability: "unspent", confirmation: status, aliasId: "address-a" }

describe("canonical confirmations", () => {
  it("uses independent lineage heights, never elapsed time", () => {
    const blake2bTip = { height: 104, hash: "aa".repeat(32), medianTimePast: 1700000100 }
    expect(confirmationsByLineage({ sha256d: status, blake2b: { ...status, lineage: "blake2b", observedTip: blake2bTip } }, { sha256d: snapshot, blake2b: { ...snapshot, lineage: "blake2b", tip: blake2bTip } })).toEqual({ sha256d: { status: "known", count: 11 }, blake2b: { status: "known", count: 5 } })
  })
  it("only returns zero for explicitly canonical mempool status at the current tip", () => {
    expect(transactionConfirmations({ ...status, canonical: "mempool", blockHeight: undefined, blockHash: undefined }, snapshot)).toEqual({ status: "known", count: 0 })
    for (const canonical of ["unknown", "orphaned"] as const) expect(transactionConfirmations({ ...status, canonical }, snapshot).status).toBe("unknown")
  })
  it("fails closed for stale, missing, mismatched and malformed snapshots", () => {
    for (const bad of [undefined, { ...snapshot, status: "stale" as const }, { ...snapshot, lineage: "blake2b" as const }, { ...snapshot, tip: { ...tip, height: 99 } }, { ...snapshot, tip: { ...tip, hash: "00".repeat(32) } }]) {
      expect(transactionConfirmations(status, bad).status).toBe("unknown")
    }
    for (const blockHeight of [-1, 111, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(transactionConfirmations({ ...status, blockHeight }, snapshot).status).toBe("unknown")
  })
})

describe("per-lineage balances", () => {
  const wallet = createWalletIdentity("one-wallet", "mainnet")
  it("deduplicates aliases and never combines lineages or USD", () => {
    const blake2bStatus = { ...status, lineage: "blake2b" as const }
    const result = walletBalances(wallet, [utxo, { ...utxo, aliasId: "address-b" }, { ...utxo, lineage: "blake2b", valueSats: BigInt(33), confirmation: blake2bStatus }], { sha256d: snapshot, blake2b: { ...snapshot, lineage: "blake2b" } })
    expect(result.sha256d.totalSats).toBe(BigInt(12))
    expect(result.blake2b.totalSats).toBe(BigInt(33))
    expect(Object.keys(result)).toEqual(["sha256d", "blake2b"])
  })
  it("excludes conflicting duplicate outpoints instead of silently choosing one", () => {
    for (const changed of [{ valueSats: BigInt(99) }, { scriptPubKeyHex: "52" }, { availability: "spent" as const }]) {
      const result = walletBalances(wallet, [utxo, { ...utxo, ...changed }], { sha256d: snapshot })
      expect(result.sha256d.status).toBe("conflict")
      expect(result.sha256d.totalSats).toBeNull()
      expect(result.sha256d.knownConfirmedSats).toBe(BigInt(0))
      expect(result.sha256d.conflictingOutpoints).toEqual([`${utxo.outpoint.txid}:0`])
    }
  })
  it("keeps unknown and stale balances unavailable, not zero", () => {
    expect(walletBalances(wallet, [utxo], {}).sha256d.totalSats).toBeNull()
    expect(walletBalances(wallet, [], {}).blake2b.totalSats).toBeNull()
    expect(walletBalances(wallet, [{ ...utxo, availability: "unknown" }], { sha256d: snapshot }).sha256d.status).toBe("partial")
    expect(walletBalances(wallet, [utxo], { sha256d: { ...snapshot, status: "stale" } }).sha256d.totalSats).toBeNull()
  })
  it("normalizes outpoint case, excludes spent outputs and keeps networks apart", () => {
    const alias = { ...utxo, outpoint: { ...utxo.outpoint, txid: utxo.outpoint.txid.toUpperCase() } }
    const spent = { ...utxo, outpoint: { ...utxo.outpoint, vout: 1 }, availability: "spent" as const }
    const testnet = { ...utxo, network: "testnet" as const, valueSats: BigInt(1000) }
    expect(walletBalances(wallet, [utxo, alias, spent, testnet], { sha256d: snapshot }).sha256d.totalSats).toBe(BigInt(12))
    expect(walletBalances(wallet, [], { sha256d: snapshot }).sha256d.totalSats).toBe(BigInt(0))
  })
  it("does not allow mismatched lineage observations to inflate balances", () => {
    const mismatched = { ...utxo, confirmation: { ...status, lineage: "blake2b" as const } }
    expect(walletBalances(wallet, [mismatched], { sha256d: snapshot }).sha256d.totalSats).toBeNull()
    expect(() => walletBalances(wallet, [{ ...utxo, valueSats: -BigInt(1) }], { sha256d: snapshot })).toThrow()
  })
  it("does not merge aliases with conflicting parent-MTP observations", () => {
    const changed = { ...utxo, confirmation: { ...status, observedTip: { ...tip, medianTimePast: tip.medianTimePast + 1 } } }
    const result = walletBalances(wallet, [utxo, changed], { sha256d: snapshot })
    expect(result.sha256d.status).toBe("conflict")
    expect(result.sha256d.totalSats).toBeNull()
    expect(transactionConfirmations(changed.confirmation, snapshot).status).toBe("unknown")
  })
  it("uses bigint throughout and separates pending from confirmed", () => {
    const pending = { ...utxo, outpoint: { ...utxo.outpoint, vout: 1 }, valueSats: BigInt("9007199254740993"), confirmation: { ...status, canonical: "mempool" as const, blockHeight: undefined, blockHash: undefined } }
    const result = walletBalances(wallet, [utxo, pending], { sha256d: snapshot })
    expect(result.sha256d.knownPendingSats).toBe(BigInt("9007199254740993"))
    expect(result.sha256d.totalSats).toBe(BigInt("9007199254741005"))
  })
})
