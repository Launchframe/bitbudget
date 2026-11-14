/**
 * Authenticated encryption for shared shopping payloads.
 *
 * Group content keys are random 32-byte secrets, wrapped to each member's existing
 * X25519 public key via {@link encryptFieldAsymmetric}. Shared fields use AES-GCM
 * with additional authenticated data so ciphertext cannot be replayed onto another
 * object, key version, or record type.
 *
 * Fail closed: plaintext, missing prefix, malformed wire format, AAD mismatch,
 * and decrypt failures throw rather than returning raw content.
 */

import {
  encryptFieldAsymmetric,
  decryptFieldAsymmetric,
  hexToUint8,
  uint8ToHex,
} from "@/lib/crypto"
import {
  SHOPPING_PAYLOAD_SCHEMA_VERSION,
  isShoppingRecordType,
  type ShoppingAad,
} from "@/lib/shopping-types"

export const SHOPPING_CIPHERTEXT_PREFIX = "sg1:"

const IV_BYTES = 12
const KEY_BYTES = 32
const HEX_KEY_RE = /^[0-9a-f]{64}$/
const WIRE_RE = /^sg1:([0-9a-f]{24}):([0-9a-f]+)$/

function toBuffer(arr: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(arr.byteLength)
  new Uint8Array(buf).set(arr)
  return buf
}

export function generateGroupContentKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES))
}

export function canonicalShoppingAad(aad: ShoppingAad): string {
  if (aad.schemaVersion !== SHOPPING_PAYLOAD_SCHEMA_VERSION) {
    throw new Error("Unsupported shopping payload version")
  }
  if (!isShoppingRecordType(aad.recordType)) {
    throw new Error("Invalid shopping record type")
  }
  if (!Number.isInteger(aad.keyVersion) || aad.keyVersion < 1) {
    throw new Error("Invalid shopping key version")
  }
  if (!Number.isInteger(aad.revision) || aad.revision < 0) {
    throw new Error("Invalid shopping revision")
  }
  return JSON.stringify({
    groupId: aad.groupId,
    keyVersion: aad.keyVersion,
    objectId: aad.objectId,
    recordType: aad.recordType,
    revision: aad.revision,
    schemaVersion: aad.schemaVersion,
  })
}

function assertLooksLikeCiphertext(value: string): void {
  if (!value || typeof value !== "string") {
    throw new Error("Shopping payload is missing")
  }
  if (!value.startsWith(SHOPPING_CIPHERTEXT_PREFIX) || !WIRE_RE.test(value)) {
    throw new Error("Shopping payload is not encrypted")
  }
}

async function importAesKey(groupKey: Uint8Array): Promise<CryptoKey> {
  if (groupKey.length !== KEY_BYTES) {
    throw new Error("Invalid group content key")
  }
  return crypto.subtle.importKey("raw", toBuffer(groupKey), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ])
}

export async function encryptShoppingPayload(
  plaintext: string,
  groupKey: Uint8Array,
  aad: ShoppingAad,
): Promise<string> {
  if (typeof plaintext !== "string") {
    throw new Error("Shopping payload must be a string")
  }
  const key = await importAesKey(groupKey)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const extra = new TextEncoder().encode(canonicalShoppingAad(aad))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(iv), additionalData: toBuffer(extra) },
    key,
    toBuffer(new TextEncoder().encode(plaintext)),
  )
  return (
    SHOPPING_CIPHERTEXT_PREFIX +
    uint8ToHex(iv) +
    ":" +
    uint8ToHex(new Uint8Array(ciphertext))
  )
}

export async function decryptShoppingPayload(
  ciphertext: string,
  groupKey: Uint8Array,
  expectedAad: ShoppingAad,
): Promise<string> {
  assertLooksLikeCiphertext(ciphertext)
  const match = WIRE_RE.exec(ciphertext)
  if (!match) throw new Error("Shopping payload is not encrypted")
  const iv = hexToUint8(match[1]!)
  const ct = hexToUint8(match[2]!)
  const key = await importAesKey(groupKey)
  const extra = new TextEncoder().encode(canonicalShoppingAad(expectedAad))
  let decrypted: ArrayBuffer
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBuffer(iv), additionalData: toBuffer(extra) },
      key,
      toBuffer(ct),
    )
  } catch {
    throw new Error("Shopping payload could not be read")
  }
  return new TextDecoder().decode(decrypted)
}

export function wrapGroupContentKey(
  groupKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): string {
  if (groupKey.length !== KEY_BYTES) {
    throw new Error("Invalid group content key")
  }
  return encryptFieldAsymmetric(uint8ToHex(groupKey), recipientPublicKey)
}

export function unwrapGroupContentKey(
  wrapped: string,
  recipientSecretKey: Uint8Array,
): Uint8Array {
  if (!wrapped || typeof wrapped !== "string") {
    throw new Error("Missing wrapped group key")
  }
  let hex: string
  try {
    hex = decryptFieldAsymmetric(wrapped, recipientSecretKey)
  } catch {
    throw new Error("Wrapped group key could not be read")
  }
  if (!HEX_KEY_RE.test(hex)) {
    throw new Error("Wrapped group key is malformed")
  }
  return hexToUint8(hex)
}

/**
 * Canonical OOB compare form: 64-bit SHA-256 prefix as `abcd-ef01-2345-6789`.
 * Short 6-hex values may still exist from a brief preview rollout; accept them for
 * storage/validation but never generate or truncate down to that strength.
 */
const CANONICAL_FINGERPRINT_RE = /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/
const SHORT_FINGERPRINT_RE = /^[0-9a-f]{6}$/

function formatCanonicalFingerprint(hex16: string): string {
  return `${hex16.slice(0, 4)}-${hex16.slice(4, 8)}-${hex16.slice(8, 12)}-${hex16.slice(12, 16)}`
}

/** True for stored or newly generated shopping key fingerprints. */
export function isShoppingKeyFingerprint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (CANONICAL_FINGERPRINT_RE.test(value) || SHORT_FINGERPRINT_RE.test(value))
  )
}

/**
 * Out-of-band compare fingerprint: first 64 bits of SHA-256(pubkey), dashed.
 * Pair with the independent join verification code when approving a request.
 * Do not shorten further — truncated digests enable practical key-substitution
 * after owner-session theft (see shopping invite security notes).
 */
export async function publicKeyFingerprint(publicKeyHex: string): Promise<string> {
  if (!HEX_KEY_RE.test(publicKeyHex)) {
    throw new Error("Invalid public key")
  }
  const digest = await crypto.subtle.digest("SHA-256", toBuffer(hexToUint8(publicKeyHex)))
  const hex = uint8ToHex(new Uint8Array(digest)).slice(0, 16)
  return formatCanonicalFingerprint(hex)
}

/**
 * Display fingerprint at full stored strength. Never truncate a 64-bit value to
 * 6 hex for UI — owners must compare the same strength the server pins.
 */
export function formatShoppingFingerprintDisplay(fingerprint: string): string {
  const hex = fingerprint.toLowerCase().replace(/[^0-9a-f]/g, "")
  if (hex.length >= 16) return formatCanonicalFingerprint(hex.slice(0, 16))
  if (SHORT_FINGERPRINT_RE.test(hex)) return hex
  return fingerprint
}

export function isShoppingCiphertext(value: unknown): value is string {
  return typeof value === "string" && WIRE_RE.test(value)
}

export function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error("Shopping payload is malformed")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Shopping payload is malformed")
  }
  const obj = parsed as Record<string, unknown>
  if (obj.schemaVersion !== SHOPPING_PAYLOAD_SCHEMA_VERSION) {
    throw new Error("Unsupported shopping payload version")
  }
  return obj
}
