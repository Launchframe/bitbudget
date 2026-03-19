/**
 * Local Nostr signing for nsec fallback (no extension).
 * Decode nsec, derive pubkey, sign auth events, fetch profile from relays.
 */

import { decode } from "nostr-tools/nip19"
import { getPublicKey, finalizeEvent } from "nostr-tools"
import type { VerifiedEvent } from "nostr-tools"

const AUTH_EVENT_KIND = 27235

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
  const template = {
    kind: AUTH_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", origin],
      ["method", "login"],
    ],
    content: "BitBudget Login",
  }
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

/**
 * Fetch kind-0 profile (name, picture) for a pubkey from relays.
 */
export async function fetchNostrProfile(pubkey: string): Promise<NostrProfile> {
  try {
    const { SimplePool } = await import("nostr-tools/pool")
    const pool = new SimplePool()
    const event = await pool.get(RELAYS, { kinds: [0], authors: [pubkey] })
    pool.close(RELAYS)
    if (!event?.content) return {}
    const meta = JSON.parse(event.content) as Record<string, string>
    return {
      name: meta.display_name || meta.name || undefined,
      image: meta.picture || undefined,
    }
  } catch {
    return {}
  }
}
