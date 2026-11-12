export const BITCOIN_LINEAGES = Object.freeze(["sha256d", "blake2b"] as const)
export const BITCOIN_NETWORKS = Object.freeze(["mainnet", "testnet", "testnet4", "signet", "regtest"] as const)
export type BitcoinLineage = typeof BITCOIN_LINEAGES[number]
export type BitcoinNetwork = typeof BITCOIN_NETWORKS[number]
export type Satoshis = bigint

export interface WalletIdentity {
  readonly id: string
  readonly network: BitcoinNetwork
  readonly lineages: typeof BITCOIN_LINEAGES
}

export interface Outpoint {
  readonly txid: string
  readonly vout: number
}

export interface ChainTip {
  readonly height: number
  readonly hash: string
  readonly medianTimePast: number
}

export interface ChainSnapshot {
  readonly network: BitcoinNetwork
  readonly lineage: BitcoinLineage
  readonly status: "fresh" | "stale" | "unknown"
  readonly tip: ChainTip | null
  readonly profileId: string | null
}

export type ChainSnapshots = Readonly<Partial<Record<BitcoinLineage, ChainSnapshot>>>

export interface TransactionChainStatus {
  readonly network: BitcoinNetwork
  readonly lineage: BitcoinLineage
  readonly canonical: "confirmed" | "mempool" | "orphaned" | "unknown"
  readonly observedTip: ChainTip | null
  readonly blockHeight?: number
  readonly blockHash?: string
}

export interface WalletUtxo {
  readonly network: BitcoinNetwork
  readonly lineage: BitcoinLineage
  readonly outpoint: Outpoint
  readonly valueSats: Satoshis
  readonly scriptPubKeyHex: string
  readonly availability: "unspent" | "spent" | "unknown"
  readonly confirmation: TransactionChainStatus
  readonly aliasId?: string
}

export function isBitcoinNetwork(value: unknown): value is BitcoinNetwork {
  return BITCOIN_NETWORKS.some(network => network === value)
}

export function isBitcoinLineage(value: unknown): value is BitcoinLineage {
  return BITCOIN_LINEAGES.some(lineage => lineage === value)
}

export function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function isHash256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)
}

export function isChainTip(value: ChainTip | null | undefined): value is ChainTip {
  return !!value && isNonnegativeSafeInteger(value.height) && isHash256(value.hash) && isNonnegativeSafeInteger(value.medianTimePast)
}

export function sameChainTip(a: ChainTip | null | undefined, b: ChainTip | null | undefined): boolean {
  return isChainTip(a) && isChainTip(b) && a.height === b.height && a.hash.toLowerCase() === b.hash.toLowerCase() && a.medianTimePast === b.medianTimePast
}

export function createWalletIdentity(id: string, network: BitcoinNetwork): WalletIdentity {
  if (typeof id !== "string" || !id.trim() || !isBitcoinNetwork(network)) throw new Error("Invalid wallet identity")
  return Object.freeze({ id, network, lineages: BITCOIN_LINEAGES })
}

export function toSatoshis(value: bigint | number | string): Satoshis {
  if (typeof value === "bigint" && value >= BigInt(0)) return value
  if (isNonnegativeSafeInteger(value)) return BigInt(value)
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value)
  throw new Error("Satoshis must be a nonnegative integer")
}

export function outpointKey(outpoint: Outpoint): string {
  if (!outpoint || !isHash256(outpoint.txid) || !isNonnegativeSafeInteger(outpoint.vout) || outpoint.vout > 0xffffffff) {
    throw new Error("Invalid transaction outpoint")
  }
  return `${outpoint.txid.toLowerCase()}:${outpoint.vout}`
}
