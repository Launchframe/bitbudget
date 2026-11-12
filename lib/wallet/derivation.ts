import { PubT, taprootTweakPubkey, validatePubkey } from "@scure/btc-signer/utils.js"
import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bech32m } from "@scure/base"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"
import { parseWalletPublicContext, type WalletPublicContext } from "@/lib/wallet/client-custody"
import type { BitcoinNetwork } from "@/lib/wallet/types"

export const PRIVATE_DERIVATION_PREFIX = "taptweak-hmac-sha256-v1:"
export const MAX_WALLET_ADDRESS_INDEX = 0x7fffffff
const NETWORK_CODE: Record<BitcoinNetwork, number> = { mainnet: 0, testnet: 1, testnet4: 2, signet: 3, regtest: 4 }
const DOMAIN = new TextEncoder().encode("BitBudget/FROST/derive/v1")

export function derivationContext(seed: Uint8Array): string {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error("Invalid wallet derivation seed")
  return PRIVATE_DERIVATION_PREFIX + bytesToHex(sha256(seed))
}

export function derivationSeedHash(context: string): string | null {
  if (context === "base-output-v1") return null
  if (!context.startsWith(PRIVATE_DERIVATION_PREFIX) || !/^[0-9a-f]{64}$/.test(context.slice(PRIVATE_DERIVATION_PREFIX.length))) throw new Error("Unsupported wallet derivation")
  return context.slice(PRIVATE_DERIVATION_PREFIX.length)
}

export function verifyDerivationSeed(seed: Uint8Array, context: string): void {
  if (derivationContext(seed) !== context) throw new Error("Wallet derivation seed mismatch")
}

export function deriveAddressTweak(seed: Uint8Array, rawContext: WalletPublicContext, branch: "receive" | "change", index: number): Uint8Array<ArrayBuffer> {
  const context = parseWalletPublicContext(rawContext)
  verifyDerivationSeed(seed, context.derivationContext)
  if (!["receive", "change"].includes(branch) || !Number.isSafeInteger(index) || index < 0 || index > MAX_WALLET_ADDRESS_INDEX) throw new Error("Invalid wallet address index")
  const input = new Uint8Array(DOMAIN.length + 32 + 6)
  input.set(DOMAIN)
  input.set(sha256(hexToBytes(context.publicPackageHex)), DOMAIN.length)
  input[DOMAIN.length + 32] = NETWORK_CODE[context.network]
  input[DOMAIN.length + 33] = branch === "receive" ? 0 : 1
  new DataView(input.buffer).setUint32(DOMAIN.length + 34, index, false)
  return Uint8Array.from(hmac(sha256, seed, input))
}

export function tweakOutputKey(rootOutputKeyHex: string, merkleRoot: Uint8Array): Uint8Array<ArrayBuffer> {
  const root = hexToBytes(rootOutputKeyHex)
  if (root.length !== 32 || merkleRoot.length !== 32) throw new Error("Invalid Taproot derivation input")
  return Uint8Array.from(taprootTweakPubkey(root, merkleRoot)[0])
}

export function outputKeyAddress(outputKey: Uint8Array, network: BitcoinNetwork): string {
  if (outputKey.length !== 32 || !Object.hasOwn(NETWORK_CODE, network)) throw new Error("Invalid wallet output key")
  validatePubkey(outputKey, PubT.schnorr)
  const prefix = network === "mainnet" ? "bc" : network === "regtest" ? "bcrt" : "tb"
  return bech32m.encode(prefix, [1, ...bech32m.toWords(outputKey)])
}

export function deriveWalletAddress(seed: Uint8Array, context: WalletPublicContext, branch: "receive" | "change", index: number) {
  const merkleRoot = deriveAddressTweak(seed, context, branch, index)
  const outputKey = tweakOutputKey(context.groupPublicKeyHex, merkleRoot)
  return { branch, index, address: outputKeyAddress(outputKey, context.network), outputKeyHex: bytesToHex(outputKey), scriptPubKeyHex: `5120${bytesToHex(outputKey)}`, merkleRootHex: bytesToHex(merkleRoot) }
}
