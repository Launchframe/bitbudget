import { custodyBytes, custodyHex, exactObject, parseWalletPublicContext, type WalletPublicContext } from "@/lib/wallet/client-custody"
import { verifyDerivationSeed } from "@/lib/wallet/derivation"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"

export interface WalletWatchEnvelope {
  version: 1
  kind: "wallet-watch-seed"
  context: WalletPublicContext
  saltHex: string
  ivHex: string
  ciphertextHex: string
}

export function parseWalletWatchEnvelope(value: unknown): WalletWatchEnvelope {
  exactObject(value, ["version", "kind", "context", "saltHex", "ivHex", "ciphertextHex"])
  if (value.version !== 1 || value.kind !== "wallet-watch-seed") throw new Error("Unsupported wallet watch envelope")
  custodyHex(value.saltHex, 32)
  custodyHex(value.ivHex, 12)
  custodyHex(value.ciphertextHex, 48)
  return { version: 1, kind: "wallet-watch-seed", context: parseWalletPublicContext(value.context), saltHex: value.saltHex, ivHex: value.ivHex, ciphertextHex: value.ciphertextHex }
}

function aad(context: WalletPublicContext) {
  return new TextEncoder().encode(JSON.stringify(["BitBudget/watch-seed/v1", parseWalletPublicContext(context)]))
}

async function keyFor(key: Uint8Array, salt: Uint8Array, context: WalletPublicContext) {
  if (key.length !== 32) throw new Error("Wallet privacy key is required")
  const copy = Uint8Array.from(key)
  try {
    const material = await crypto.subtle.importKey("raw", copy, "HKDF", false, ["deriveKey"])
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: custodyBytes(salt), info: aad(context) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  } finally { copy.fill(0) }
}

export async function sealWalletWatchSeed(seed: Uint8Array, privacyKey: Uint8Array, rawContext: WalletPublicContext): Promise<WalletWatchEnvelope> {
  const context = parseWalletPublicContext(rawContext)
  verifyDerivationSeed(seed, context.derivationContext)
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = Uint8Array.from(seed)
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(context) }, await keyFor(privacyKey, salt, context), plain)
    return { version: 1, kind: "wallet-watch-seed", context, saltHex: bytesToHex(salt), ivHex: bytesToHex(iv), ciphertextHex: bytesToHex(new Uint8Array(ciphertext)) }
  } finally { plain.fill(0) }
}

export async function openWalletWatchSeed(value: unknown, privacyKey: Uint8Array, expectedContext: WalletPublicContext): Promise<Uint8Array<ArrayBuffer>> {
  const envelope = parseWalletWatchEnvelope(value)
  if (JSON.stringify(envelope.context) !== JSON.stringify(parseWalletPublicContext(expectedContext))) throw new Error("Wallet watch context mismatch")
  const seed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(envelope.ivHex), additionalData: aad(envelope.context) }, await keyFor(privacyKey, hexToBytes(envelope.saltHex), envelope.context), hexToBytes(envelope.ciphertextHex)))
  try { verifyDerivationSeed(seed, envelope.context.derivationContext); return seed } catch { seed.fill(0); throw new Error("Wallet watch seed mismatch") }
}
