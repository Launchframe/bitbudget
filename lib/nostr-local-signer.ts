/**
 * Local Nostr signing for nsec fallback (no extension).
 * Decode nsec, derive pubkey, sign auth events, fetch profile from relays.
 */

import { decode } from "nostr-tools/nip19"
import { getPublicKey, finalizeEvent } from "nostr-tools"
import type { VerifiedEvent } from "nostr-tools"
import {
  NOSTR_AUTH_EVENT_CONTENT,
  NOSTR_AUTH_EVENT_KIND,
  NOSTR_AUTH_EVENT_METHOD,
} from "@/lib/nostr-auth-event"

/** Unsigned auth event template (kind 27235) for extension or local signing. */
export interface AuthEventTemplate {
  kind: number
  created_at: number
  tags: string[][]
  content: string
  pubkey?: string
}

/**
 * Build the unsigned auth event template for the given origin.
 * Extension flow: spread this, add pubkey, then call extension.signEvent().
 * Nsec flow: use signAuthEvent() which builds and signs in one step.
 */
export function buildAuthEventTemplate(origin: string): AuthEventTemplate {
  return {
    kind: NOSTR_AUTH_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", origin],
      ["method", NOSTR_AUTH_EVENT_METHOD],
    ],
    content: NOSTR_AUTH_EVENT_CONTENT,
  }
}

/** Default wait for extension getPublicKey / signEvent (some policies never resolve). */
export const NOSTR_EXTENSION_TIMEOUT_MS = 10_000

export class NostrExtensionTimeoutError extends Error {
  constructor() {
    super("NOSTR_EXTENSION_TIMEOUT")
    this.name = "NostrExtensionTimeoutError"
  }
}

/** Reject when `promise` does not settle within `timeoutMs` (clears hung extension calls). */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new NostrExtensionTimeoutError()), timeoutMs)
    }),
  ])
}

/** Normalize hex or npub from a NIP-07 extension to lowercase hex. */
export function normalizeHexPubkey(value: string): string {
  const trimmed = value.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^npub1/i.test(trimmed)) {
    const decoded = decode(trimmed.toLowerCase())
    if (decoded.type !== "npub" || typeof decoded.data !== "string") {
      throw new Error("Invalid Nostr public key from extension")
    }
    if (!/^[0-9a-f]{64}$/i.test(decoded.data)) {
      throw new Error("Invalid Nostr public key from extension")
    }
    return decoded.data.toLowerCase()
  }
  throw new Error("Invalid Nostr public key from extension")
}

export interface DecodedNsecResult {
  secretKey: Uint8Array
  pubkey: string
}

/**
 * Decode a bech32 nsec string and return the secret key and hex pubkey.
 * @throws if the string is not a valid nsec
 */
export function decodeNsec(nsec: string): DecodedNsecResult {
  const trimmed = nsec.trim()
  // Bech32 must be all-lower or all-upper (@scure/base rejects mixed case). Normalize to lower.
  if (!trimmed.toLowerCase().startsWith("nsec1")) {
    throw new Error("Invalid nsec: must start with nsec1")
  }
  const decoded = decode(trimmed.toLowerCase())
  if (decoded.type !== "nsec") {
    throw new Error("Invalid nsec format")
  }
  const raw = decoded.data
  if (!(raw instanceof Uint8Array)) {
    throw new Error("Invalid nsec: decoded data is not a Uint8Array")
  }
  if (raw.length !== 32) {
    throw new Error("Invalid nsec: secret key must be 32 bytes")
  }
  const secretKey = raw
  const pubkey = getPublicKey(secretKey)
  return { secretKey, pubkey }
}

/**
 * Build and sign a kind-27235 auth event for the given origin.
 */
export function signAuthEvent(secretKey: Uint8Array, origin: string): VerifiedEvent {
  const template = buildAuthEventTemplate(origin)
  return finalizeEvent(template, secretKey)
}

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
]

export interface NostrProfile {
  name?: string
  image?: string
}

/** Minimal type for Nostr relay pool used in fetchNostrProfile. */
interface NostrPool {
  get(
    relays: string[],
    filter: { kinds: number[]; authors: string[] }
  ): Promise<{ content?: string } | null>
  close(relays: string[]): void
}

// ---------------------------------------------------------------------------
// Pending nsec (auth → onboarding): in-memory only
// ---------------------------------------------------------------------------
// Raw key bytes stay in this tab’s JS heap until the PIN step encrypts to
// `bitbudget-nsec` (localStorage). We intentionally do not mirror the secret to
// sessionStorage (XSS / shared-device risk). A full reload before PIN setup
// clears memory; `bitbudget-nsec-onboarding-intent` + missing key triggers sign-out
// in onboarding so the user re-authenticates.
// Legacy: older builds used `bitbudget-pending-nsec` in sessionStorage — removed on clear.

/** Legacy sessionStorage key (no longer written; cleared in `clearPendingNsec`). */
export const PENDING_NSEC_SESSION_KEY = "bitbudget-pending-nsec"

let _pendingNsec: Uint8Array | null = null

/** Hold a raw nsec so the onboarding security step can encrypt it. */
export function setPendingNsec(key: Uint8Array): void {
  _pendingNsec = key
}

/** Read the pending nsec (returns null if none). Does NOT clear it. */
export function getPendingNsec(): Uint8Array | null {
  return _pendingNsec
}

/** Wipe the pending nsec from memory and any legacy sessionStorage copy. */
export function clearPendingNsec(): void {
  if (_pendingNsec) {
    _pendingNsec.fill(0)
    _pendingNsec = null
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(PENDING_NSEC_SESSION_KEY)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Session flag: user signed in via nsec paste and still owes the onboarding PIN step.
 * Used with `getPendingNsec()` to detect reload where memory was cleared but key may
 * still be in sessionStorage — or to sign out when intent exists but the key is gone.
 */
export const NSEC_ONBOARDING_INTENT_KEY = "bitbudget-nsec-onboarding-intent"

export function setNsecOnboardingIntent(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(NSEC_ONBOARDING_INTENT_KEY, "1")
    }
  } catch {
    /* ignore */
  }
}

export function clearNsecOnboardingIntent(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(NSEC_ONBOARDING_INTENT_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function hasNsecOnboardingIntent(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(NSEC_ONBOARDING_INTENT_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * Fetch kind-0 profile metadata for a pubkey from relays.
 * Returns `name` (from display_name or name) and `image` (from picture).
 */
export async function fetchNostrProfile(
  pubkey: string,
  timeoutMs = 4000,
): Promise<NostrProfile> {
  let pool: NostrPool | undefined
  try {
    const { SimplePool } = await import("nostr-tools/pool")
    pool = new SimplePool() as NostrPool
    const event = await Promise.race([
      pool.get(RELAYS, { kinds: [0], authors: [pubkey] }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
    if (!event?.content) return {}
    const meta = JSON.parse(event.content) as Record<string, string>
    return {
      name: meta.display_name || meta.name || undefined,
      image: meta.picture || undefined,
    }
  } catch {
    return {}
  } finally {
    if (pool) {
      try {
        pool.close(RELAYS)
      } catch {
        // ignore close errors
      }
    }
  }
}
