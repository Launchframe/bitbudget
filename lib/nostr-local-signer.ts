/**
 * Local Nostr signing for nsec fallback (no extension).
 * Decode nsec, derive pubkey, sign auth events, fetch profile from relays.
 */

import { decode } from "nostr-tools/nip19"
import { getPublicKey, finalizeEvent } from "nostr-tools"
import type { VerifiedEvent } from "nostr-tools"

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
  if (!trimmed.startsWith("nsec1")) {
    throw new Error("Invalid nsec: must start with nsec1")
  }
  const decoded = decode(trimmed)
  if (decoded.type !== "nsec") {
    throw new Error("Invalid nsec format")
  }
  const secretKey = decoded.data
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
// In-memory pending nsec (auth page → onboarding bridge, never touches storage)
// ---------------------------------------------------------------------------

let _pendingNsec: Uint8Array | null = null

/** Hold a raw nsec in memory so the onboarding security step can encrypt it. */
export function setPendingNsec(key: Uint8Array): void {
  _pendingNsec = key
}

/** Read the pending nsec (returns null if none). Does NOT clear it. */
export function getPendingNsec(): Uint8Array | null {
  return _pendingNsec
}

/** Wipe the pending nsec from memory. */
export function clearPendingNsec(): void {
  if (_pendingNsec) {
    _pendingNsec.fill(0)
    _pendingNsec = null
  }
}

/**
 * Fetch kind-0 profile (name, picture) for a pubkey from relays.
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
