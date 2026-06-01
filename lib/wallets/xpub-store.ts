/**
 * Encrypted-at-rest storage for the user's xpubs and per-wallet config.
 *
 * **Privacy invariants (do not break):**
 * - The raw xpub never leaves this device. Nothing in this module ever sends
 *   wallet data to the server. There is no fetch / XHR here, by design.
 * - Wallet records are encrypted with the unlocked privacy key (`encryptField`,
 *   AES-GCM via Web Crypto). Without the privacy key (PIN/passphrase or
 *   Nostr-extension unwrap), the blob in `localStorage` is opaque.
 * - Per-user namespace prevents cross-account leakage if multiple BitBudget
 *   accounts share a browser profile.
 *
 * Wire format in `localStorage`:
 *
 *   key:   `bitbudget-wallets-<userId>`
 *   value: `<iv-hex>:<ciphertext-hex>` (output of `encryptField`) of a JSON
 *          payload `{ version, wallets: StoredWallet[] }`.
 *
 * Versioning: bump `WALLETS_BLOB_VERSION` if the StoredWallet shape changes
 * incompatibly; readers tolerate older versions and surface a migration error
 * rather than silently dropping fields.
 */

import { decryptField, encryptField } from "@/lib/crypto"
import { normalizeExplorerBaseUrl } from "@/lib/wallets/esplora-client"

export const WALLETS_BLOB_VERSION = 1
export const STORAGE_KEY_PREFIX = "bitbudget-wallets-"

/** BIP version-byte-derived wallet kind. We support the three common ones. */
export type WalletKind = "bip44" | "bip49" | "bip84"

export const DEFAULT_GAP_LIMIT = 20
export const DEFAULT_EXPLORER_URL = "https://mempool.space"

export interface StoredWallet {
  /** Local-only id; never sent to the server. */
  id: string
  /** User-supplied human label, e.g. "Cold storage". */
  nickname: string
  /** Raw extended pubkey as the user pasted it (xpub/ypub/zpub/...). */
  xpub: string
  /** Detected from xpub version bytes at add time. */
  kind: WalletKind
  /** BIP44 gap-limit; used by the sync engine to decide when to stop scanning. */
  gapLimit: number
  /** Default envelope for transactions imported from this wallet. Null = first active envelope. */
  defaultEnvelopeId: string | null
  /** User-chosen Esplora-compatible base URL (no trailing slash). */
  explorerBaseUrl: string
  /** ISO timestamp the wallet was added. */
  addedAt: string
  /** ISO timestamp of the last successful sync (any tx imported or no-op). */
  lastSyncAt: string | null
}

interface WalletsBlob {
  version: number
  wallets: StoredWallet[]
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`
}

function readRaw(userId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

function writeRaw(userId: string, value: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey(userId), value)
  } catch {
    throw new Error("Failed to write wallets to localStorage (storage may be full or blocked).")
  }
}

function clearRaw(userId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(storageKey(userId))
  } catch {
    /* ignore */
  }
}

function sanitizeExplorerBase(url: string): string {
  return normalizeExplorerBaseUrl(url)
}

function normalizeWallet(w: StoredWallet): StoredWallet {
  return {
    ...w,
    explorerBaseUrl: sanitizeExplorerBase(w.explorerBaseUrl),
  }
}

function parseBlob(json: string): WalletsBlob {
  const parsed = JSON.parse(json) as unknown
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("wallets" in parsed) ||
    !Array.isArray((parsed as { wallets: unknown }).wallets)
  ) {
    throw new Error("Wallets blob is malformed")
  }
  const obj = parsed as { version?: number; wallets: StoredWallet[] }
  return {
    version: typeof obj.version === "number" ? obj.version : 0,
    wallets: obj.wallets.map(normalizeWallet),
  }
}

/**
 * Decrypts and returns the user's stored wallets. Returns `[]` when there is
 * no blob yet. Throws when a blob exists but cannot be decrypted (wrong key,
 * tampered storage, etc.) so callers can prompt for re-unlock instead of
 * silently overwriting wallet data.
 */
export async function loadWallets(
  userId: string,
  privacyKey: Uint8Array,
): Promise<StoredWallet[]> {
  const raw = readRaw(userId)
  if (!raw) return []
  const json = await decryptField(raw, privacyKey)
  if (json === raw) {
    throw new Error("Wallets blob is not in encrypted format")
  }
  const blob = parseBlob(json)
  return blob.wallets
}

/**
 * Encrypts and persists the full wallet list. Atomic: callers should always
 * read → mutate → save, never partial writes.
 */
export async function saveWallets(
  userId: string,
  privacyKey: Uint8Array,
  wallets: StoredWallet[],
): Promise<void> {
  const blob: WalletsBlob = {
    version: WALLETS_BLOB_VERSION,
    wallets: wallets.map(normalizeWallet),
  }
  const ciphertext = await encryptField(JSON.stringify(blob), privacyKey)
  writeRaw(userId, ciphertext)
}

export function clearWallets(userId: string): void {
  clearRaw(userId)
}

/** True when a non-empty wallets blob exists for this user (no decryption needed). */
export function hasStoredWallets(userId: string): boolean {
  const raw = readRaw(userId)
  return Boolean(raw && raw.length > 0)
}

export interface AddWalletInput {
  nickname: string
  xpub: string
  kind: WalletKind
  defaultEnvelopeId?: string | null
  explorerBaseUrl?: string
  gapLimit?: number
}

function generateLocalId(): string {
  // Local-only id; never sent to the server. Random + timestamp is enough.
  const rand = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `wlt_${Date.now().toString(36)}_${rand.slice(0, 8)}`
}

export function buildStoredWallet(input: AddWalletInput, now: Date = new Date()): StoredWallet {
  return normalizeWallet({
    id: generateLocalId(),
    nickname: input.nickname.trim(),
    xpub: input.xpub.trim(),
    kind: input.kind,
    gapLimit: input.gapLimit ?? DEFAULT_GAP_LIMIT,
    defaultEnvelopeId: input.defaultEnvelopeId ?? null,
    explorerBaseUrl: input.explorerBaseUrl ?? DEFAULT_EXPLORER_URL,
    addedAt: now.toISOString(),
    lastSyncAt: null,
  })
}

/**
 * `http:` is only allowed for local-network or .onion hosts so users do not
 * silently send their wallet's address graph over plaintext to a public server.
 *
 * Allowed:
 *  - any `https:` URL with a non-empty host
 *  - `http://` only when host is loopback, `.local`, `.onion`, or RFC1918
 */
export function isAllowedExplorerBase(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: "Not a valid URL" }
  }
  if (!parsed.hostname) {
    return { ok: false, reason: "URL is missing a host" }
  }
  if (parsed.protocol === "https:") {
    return { ok: true }
  }
  if (parsed.protocol === "http:") {
    if (isLocalOrOnionHost(parsed.hostname)) return { ok: true }
    return {
      ok: false,
      reason:
        "Plain http:// is only allowed for local-network nodes (.local, .onion, loopback, or RFC1918 IPs). Use https:// for public explorers.",
    }
  }
  return { ok: false, reason: `Unsupported scheme ${parsed.protocol}` }
}

function isLocalOrOnionHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".onion")) return true
  if (h === "127.0.0.1" || h === "::1") return true

  const parts = h.split(".")
  const isIpv4 =
    parts.length === 4 &&
    parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
  if (!isIpv4) return false

  const [a, b] = parts.map(Number)
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}
