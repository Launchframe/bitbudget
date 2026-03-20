/**
 * Local Nostr signing for nsec fallback (no extension).
 * Decode nsec, derive pubkey, sign auth events, fetch profile from relays.
 */

import { decode } from "nostr-tools/nip19"
import { getPublicKey, finalizeEvent } from "nostr-tools"
import type { VerifiedEvent } from "nostr-tools"
import { hexToUint8, uint8ToHex } from "@/lib/crypto"

const AUTH_EVENT_KIND = 27235

const AUTH_EVENT_CONTENT = "BitBudget Login"

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
    kind: AUTH_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", origin],
      ["method", "login"],
    ],
    content: AUTH_EVENT_CONTENT,
  }
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
// Pending nsec (auth → onboarding): in-memory + sessionStorage hex mirror
// ---------------------------------------------------------------------------
// Raw key bytes are mirrored to sessionStorage so a full reload can still reach
// the PIN encrypt step. This trades a larger XSS blast radius for UX (reload survival);
// at-rest protection is `bitbudget-nsec` (PIN-encrypted JSON) after the security step.
// Intent flag `bitbudget-nsec-onboarding-intent` marks nsec-login users who owe PIN setup.

/** Hex-encoded secret key bytes; cleared with `clearPendingNsec()`. */
export const PENDING_NSEC_SESSION_KEY = "bitbudget-pending-nsec"

let _pendingNsec: Uint8Array | null = null

/** Hold a raw nsec so the onboarding security step can encrypt it. */
export function setPendingNsec(key: Uint8Array): void {
  _pendingNsec = key
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(PENDING_NSEC_SESSION_KEY, uint8ToHex(key))
    }
  } catch {
    /* private mode / quota */
  }
}

/** Read the pending nsec (returns null if none). Does NOT clear it. */
export function getPendingNsec(): Uint8Array | null {
  if (_pendingNsec) return _pendingNsec
  try {
    if (typeof sessionStorage !== "undefined") {
      const hex = sessionStorage.getItem(PENDING_NSEC_SESSION_KEY)
      if (!hex) return null
      const bytes = hexToUint8(hex)
      if (bytes.length !== 32) {
        sessionStorage.removeItem(PENDING_NSEC_SESSION_KEY)
        return null
      }
      _pendingNsec = bytes
      return _pendingNsec
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Wipe the pending nsec from memory and sessionStorage. */
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
export async function fetchNostrProfile(pubkey: string): Promise<NostrProfile> {
  let pool: NostrPool | undefined
  try {
    const { SimplePool } = await import("nostr-tools/pool")
    pool = new SimplePool() as NostrPool
    const event = await pool.get(RELAYS, { kinds: [0], authors: [pubkey] })
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
