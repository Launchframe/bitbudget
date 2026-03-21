/**
 * Client-side E2E encryption utilities.
 *
 * For Web 2.0 users: a passphrase derives an AES-GCM key via PBKDF2. That key wraps
 * a random "privacy key" which is stored (encrypted) server-side.
 *
 * For Nostr users: encryption uses the nostr extension (NIP-04 or NIP-44), or
 * for nsec fallback users the app encrypts the nsec at rest with the same
 * PIN-derived key used for the privacy key.
 *
 * Asymmetric encryption (X25519 + XSalsa20-Poly1305 via tweetnacl) allows
 * the server to encrypt fields with a user's public key when creating
 * transactions from backend sources (Plaid, email, SMS). Only the client
 * holding the private key can decrypt.
 */

import nacl from "tweetnacl"
import naclUtil from "tweetnacl-util"

const PBKDF2_ITERATIONS = 600_000

function toBuffer(arr: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(arr.byteLength)
  new Uint8Array(buf).set(arr)
  return buf
}

export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toBuffer(enc.encode(pin)),
    "PBKDF2",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export function generatePrivacyKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function encryptPrivacyKey(
  privacyKey: Uint8Array,
  wrappingKey: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(iv) },
    wrappingKey,
    toBuffer(privacyKey),
  )
  return {
    iv: uint8ToHex(iv),
    ciphertext: uint8ToHex(new Uint8Array(ciphertext)),
  }
}

export async function decryptPrivacyKey(
  encryptedData: { iv: string; ciphertext: string },
  wrappingKey: CryptoKey,
): Promise<Uint8Array> {
  const iv = hexToUint8(encryptedData.iv)
  const ciphertext = hexToUint8(encryptedData.ciphertext)
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBuffer(iv) },
    wrappingKey,
    toBuffer(ciphertext),
  )
  return new Uint8Array(decrypted)
}

export async function encryptField(plaintext: string, privacyKey: Uint8Array): Promise<string> {
  if (!plaintext) return plaintext
  const key = await crypto.subtle.importKey(
    "raw",
    toBuffer(privacyKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(iv) },
    key,
    toBuffer(enc.encode(plaintext)),
  )
  return uint8ToHex(iv) + ":" + uint8ToHex(new Uint8Array(ciphertext))
}

const ENCRYPTED_FIELD_RE = /^[0-9a-f]{24}:[0-9a-f]+$/

export async function decryptField(encrypted: string, privacyKey: Uint8Array): Promise<string> {
  if (!encrypted || !ENCRYPTED_FIELD_RE.test(encrypted)) return encrypted
  const [ivHex, ctHex] = encrypted.split(":")
  const key = await crypto.subtle.importKey(
    "raw",
    toBuffer(privacyKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  )
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBuffer(hexToUint8(ivHex)) },
    key,
    toBuffer(hexToUint8(ctHex)),
  )
  return new TextDecoder().decode(decrypted)
}

export function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

export function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

// ─── Asymmetric encryption (X25519) ─────────────────────────────────

export async function deriveAsymmetricSeed(
  passphrase: string,
  salt: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  )
  return new Uint8Array(bits)
}

export function generateKeyPairFromSeed(
  seed: Uint8Array,
): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.box.keyPair.fromSecretKey(seed)
}

/**
 * Encrypt a field so only the holder of the recipient's secret key can read it.
 * Uses an ephemeral key pair per encryption (sealed-box pattern) so the server
 * doesn't need a persistent identity.
 *
 * Wire format (base64-encoded): ephemeralPubKey (32) || nonce (24) || ciphertext
 */
export function encryptFieldAsymmetric(
  plaintext: string,
  recipientPublicKey: Uint8Array,
): string {
  const ephemeral = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const messageBytes = naclUtil.decodeUTF8(plaintext)
  const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeral.secretKey)
  if (!encrypted) throw new Error("Asymmetric encryption failed")
  const combined = new Uint8Array(
    nacl.box.publicKeyLength + nacl.box.nonceLength + encrypted.length,
  )
  combined.set(ephemeral.publicKey, 0)
  combined.set(nonce, nacl.box.publicKeyLength)
  combined.set(encrypted, nacl.box.publicKeyLength + nacl.box.nonceLength)
  return naclUtil.encodeBase64(combined)
}

export function decryptFieldAsymmetric(
  ciphertext: string,
  recipientSecretKey: Uint8Array,
): string {
  const combined = naclUtil.decodeBase64(ciphertext)
  const ephemeralPk = combined.slice(0, nacl.box.publicKeyLength)
  const nonce = combined.slice(
    nacl.box.publicKeyLength,
    nacl.box.publicKeyLength + nacl.box.nonceLength,
  )
  const encrypted = combined.slice(nacl.box.publicKeyLength + nacl.box.nonceLength)
  const decrypted = nacl.box.open(encrypted, nonce, ephemeralPk, recipientSecretKey)
  if (!decrypted) throw new Error("Asymmetric decryption failed — wrong key or corrupted data")
  return naclUtil.encodeUTF8(decrypted)
}

const MIN_SEALED_BOX_B64_LEN = 96
const B64_RE = /^[A-Za-z0-9+/=]+$/

/**
 * Heuristic: does the string look like an undecrypted NaCl sealed-box ciphertext?
 * Used to mask fields we failed to decrypt so raw ciphertext never reaches the UI.
 */
export function looksEncrypted(value: string): boolean {
  return value.length >= MIN_SEALED_BOX_B64_LEN && B64_RE.test(value)
}

export function publicKeyToHex(key: Uint8Array): string {
  return uint8ToHex(key)
}

export function hexToPublicKey(hex: string): Uint8Array {
  return hexToUint8(hex)
}
