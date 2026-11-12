/**
 * Privacy-preserving idempotency key for CSV imports.
 *
 * The server cannot read the (encrypted) payee, so it cannot detect duplicate
 * imports on its own. Instead the client derives a deterministic HMAC fingerprint
 * from the transaction's business identity (date, type, payee, amount) keyed by the
 * user's privacy-key seed — which the server never sees. Identical transactions
 * encrypted by the same client therefore produce the same `dedupeKey`, letting the
 * server dedupe via a partial unique index + `createMany({ skipDuplicates: true })`
 * without ever being able to reverse the key back to a payee.
 *
 * An occurrence counter is appended per base key so that genuinely-identical rows
 * within a single import (e.g. two coffees of the same price on the same day) are
 * preserved, while re-importing the same file still maps to the same keys and dedupes.
 */
import { hmac } from "@noble/hashes/hmac.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js"
import type { TransactionType } from "@/lib/data"
import { transactionCollisionKey } from "@/lib/transaction-dedup"

/** Domain separation tag — bump the version if the key derivation ever changes. */
export const DEDUPE_KEY_DOMAIN = "bitbudget-dedupe-v1"

/** 128-bit truncation: collision-resistant per user while keeping the column lean. */
const DEDUPE_KEY_BYTES = 16

export interface DedupeCandidate {
  date: string
  payee: string
  amount: number
  type: TransactionType
}

/** Stateful per-import computer: tracks occurrence counts across all chunks. */
export type DedupeKeyComputer = (candidate: DedupeCandidate) => string

function normalizeSeedHex(seedHex: string): string {
  const hex = seedHex.trim().toLowerCase()
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error("Invalid privacy-key seed for dedupe key derivation")
  }
  // Minimum 16 bytes (32 hex chars) for a safe HMAC key. A shorter key (e.g. 1 byte = 256
  // possible HMACs) is trivially brute-forceable. The legitimate client always supplies a
  // 32-byte NaCl seed (64 hex chars); this guard is pure defence-in-depth.
  if (hex.length < 32) {
    throw new Error(
      "Privacy-key seed too short for safe HMAC derivation (minimum 16 bytes / 32 hex chars)",
    )
  }
  return hex
}

/**
 * Build a dedupe-key computer bound to a user's privacy-key seed.
 *
 * Create ONE computer per import and reuse it across all chunks so the occurrence
 * counter stays consistent for repeated identical rows.
 */
export function makeDedupeKeyComputer(seedHex: string): DedupeKeyComputer {
  const key = hexToBytes(normalizeSeedHex(seedHex))
  const occurrences = new Map<string, number>()

  return (candidate: DedupeCandidate): string => {
    const base = transactionCollisionKey(candidate)
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    const message = `${DEDUPE_KEY_DOMAIN}|${base}#${occurrence}`
    const mac = hmac(sha256, key, utf8ToBytes(message))
    return bytesToHex(mac.slice(0, DEDUPE_KEY_BYTES))
  }
}
