/**
 * BIP32 / BIP44 / BIP49 / BIP84 address derivation.
 *
 * **Privacy invariant:** all functions in this file are pure and synchronous.
 * Nothing in here ever performs network I/O. The xpub passed in is processed
 * entirely in memory and only addresses (or HDKeys) come back out. This file
 * is consumed both from the main thread and from the sync Web Worker.
 *
 * Supported extended-pubkey prefixes (mainnet only):
 *
 *   xpub (0x0488B21E) → BIP44 / P2PKH         ("1...")
 *   ypub (0x049D7CB2) → BIP49 / P2SH-P2WPKH   ("3...")
 *   zpub (0x04B24746) → BIP84 / native P2WPKH ("bc1q...")
 *
 * We deliberately reject testnet keys (tpub/upub/vpub) and unknown version
 * bytes: silently treating an unknown key as `xpub` would mis-derive the
 * wrong address set and could send a user looking for transactions that
 * don't exist on their wallet.
 */

import { HDKey } from "@scure/bip32"
import { base58check, bech32 } from "@scure/base"
import { sha256 } from "@noble/hashes/sha2.js"
import { ripemd160 } from "@noble/hashes/legacy.js"

import type { WalletKind } from "@/lib/wallets/xpub-store"

/** BIP32 standard mainnet xpub version: `04 88 B2 1E`. */
const XPUB_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e])

const VERSION_TO_KIND: Record<string, WalletKind> = {
  // mainnet xpub
  "0488b21e": "bip44",
  // mainnet ypub (BIP49)
  "049d7cb2": "bip49",
  // mainnet zpub (BIP84)
  "04b24746": "bip84",
}

const base58 = base58check(sha256)

function bytesToHex(b: Uint8Array): string {
  let s = ""
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0")
  return s
}

function hash160(input: Uint8Array): Uint8Array {
  return ripemd160(sha256(input))
}

export interface ParsedExtendedKey {
  kind: WalletKind
  /** HDKey constructed from a normalized xpub (always BIP32 mainnet xpub version). */
  hdkey: HDKey
}

/**
 * Parse an `xpub`, `ypub`, or `zpub`. Throws with a user-friendly message on
 * invalid input. The returned `hdkey` is keyed off the **account-level** xpub
 * the user provided; callers derive children at `m/<chain>/<index>`.
 */
export function parseExtendedKey(input: string): ParsedExtendedKey {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Extended public key is empty")
  let raw: Uint8Array
  try {
    raw = base58.decode(trimmed)
  } catch {
    throw new Error("Extended public key checksum failed — check for typos")
  }
  if (raw.length !== 78) {
    throw new Error(`Extended public key has wrong length (${raw.length}, expected 78)`)
  }
  const versionHex = bytesToHex(raw.slice(0, 4))
  const kind = VERSION_TO_KIND[versionHex]
  if (!kind) {
    throw new Error(
      `Unrecognized extended-pubkey prefix (${versionHex}). BitBudget supports xpub, ypub, and zpub on Bitcoin mainnet.`,
    )
  }

  const normalized = new Uint8Array(78)
  normalized.set(XPUB_VERSION, 0)
  normalized.set(raw.slice(4), 4)
  const normalizedB58 = base58.encode(normalized)

  let hdkey: HDKey
  try {
    hdkey = HDKey.fromExtendedKey(normalizedB58)
  } catch {
    throw new Error("Extended public key could not be parsed (BIP32 decode error)")
  }

  return { kind, hdkey }
}

/** Lower-cased hex of the 4-byte version prefix; useful for diagnostics. */
export function extendedKeyVersionHex(input: string): string | null {
  try {
    const raw = base58.decode(input.trim())
    if (raw.length !== 78) return null
    return bytesToHex(raw.slice(0, 4))
  } catch {
    return null
  }
}

/**
 * P2PKH (legacy, BIP44, addresses start with "1").
 * Encoding: Base58Check( 0x00 || HASH160(pubkey) ).
 */
export function pubkeyToP2PKH(pubkey: Uint8Array): string {
  const payload = new Uint8Array(21)
  payload[0] = 0x00
  payload.set(hash160(pubkey), 1)
  return base58.encode(payload)
}

/**
 * P2SH-wrapped P2WPKH (BIP49, addresses start with "3").
 * scriptPubKey of the inner segwit-v0 program is `0x00 0x14 || HASH160(pubkey)`,
 * outer P2SH = Base58Check( 0x05 || HASH160(scriptPubKey) ).
 */
export function pubkeyToP2SHP2WPKH(pubkey: Uint8Array): string {
  const program = new Uint8Array(22)
  program[0] = 0x00
  program[1] = 0x14
  program.set(hash160(pubkey), 2)
  const payload = new Uint8Array(21)
  payload[0] = 0x05
  payload.set(hash160(program), 1)
  return base58.encode(payload)
}

/**
 * Native segwit v0 P2WPKH (BIP84, "bc1q..."). 20-byte witness program.
 * Bech32 (not bech32m, which is for v1+). Mainnet HRP is "bc".
 */
export function pubkeyToP2WPKH(pubkey: Uint8Array): string {
  const program = hash160(pubkey)
  const words = bech32.toWords(program)
  const data = new Uint8Array(words.length + 1)
  data[0] = 0
  data.set(words, 1)
  return bech32.encode("bc", data)
}

export function deriveAddressForKind(pubkey: Uint8Array, kind: WalletKind): string {
  switch (kind) {
    case "bip44": return pubkeyToP2PKH(pubkey)
    case "bip49": return pubkeyToP2SHP2WPKH(pubkey)
    case "bip84": return pubkeyToP2WPKH(pubkey)
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      throw new Error(`Unsupported wallet kind: ${String(kind)}`)
    }
  }
}

/**
 * Derive the address at chain `chain` (0 = receive, 1 = change) and `index`
 * relative to the account-level xpub. The returned address matches the kind
 * of the original extended pubkey.
 */
export function deriveAddress(
  parsed: ParsedExtendedKey,
  chain: 0 | 1,
  index: number,
): string {
  const child = parsed.hdkey.deriveChild(chain).deriveChild(index)
  if (!child.publicKey) throw new Error("HDKey derivation produced no public key")
  return deriveAddressForKind(child.publicKey, parsed.kind)
}

/**
 * Derive a contiguous range of addresses [start, endExclusive). Convenience
 * for gap-limit scanning; same kind as the input extended pubkey.
 */
export function deriveAddressRange(
  parsed: ParsedExtendedKey,
  chain: 0 | 1,
  start: number,
  endExclusive: number,
): string[] {
  if (endExclusive < start) throw new Error("endExclusive must be >= start")
  const out: string[] = []
  for (let i = start; i < endExclusive; i++) {
    out.push(deriveAddress(parsed, chain, i))
  }
  return out
}
