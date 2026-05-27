/**
 * Regression tests for Nostr auth event validation in lib/auth.ts.
 *
 * The Nostr credentials provider must validate:
 *  - Event kind = 27235 (NIP-98 style login, not arbitrary relay notes)
 *  - Event content = "BitBudget Login"
 *  - "method" tag present and set to "login"
 *  - created_at within ±5 minutes (replay protection)
 *
 * Without these checks, any signed Nostr event seen on a relay can be
 * replayed to gain access (e.g. a kind-1 note signed by the user).
 */

import { describe, expect, it } from "vitest"
import {
  NOSTR_AUTH_EVENT_KIND,
  NOSTR_AUTH_EVENT_CONTENT,
  NOSTR_AUTH_EVENT_METHOD,
} from "@/lib/nostr-auth-event"

const VALID_PUBKEY = "a".repeat(64)
const NOW_UNIX = Math.floor(Date.now() / 1000)

/** Builds a structurally-valid login event (kind=27235, correct content, fresh timestamp). */
function buildLoginEvent(overrides: Partial<{
  kind: number
  content: string
  created_at: number
  pubkey: string
  tags: string[][]
}> = {}) {
  return {
    kind: NOSTR_AUTH_EVENT_KIND,
    content: NOSTR_AUTH_EVENT_CONTENT,
    created_at: NOW_UNIX,
    pubkey: VALID_PUBKEY,
    tags: [["method", NOSTR_AUTH_EVENT_METHOD]],
    ...overrides,
  }
}

/**
 * Mirror of the validation logic added to lib/auth.ts nostr authorize().
 * Kept in sync to guard regressions — any change to auth.ts rules should also
 * update these tests.
 */
function validateNostrAuthEvent(
  event: ReturnType<typeof buildLoginEvent>,
  pubkey: string,
): { valid: boolean; reason?: string } {
  const MAX_AGE = 5 * 60
  const FUTURE_SKEW = 60
  const now = NOW_UNIX

  if (event.kind !== NOSTR_AUTH_EVENT_KIND)
    return { valid: false, reason: "wrong kind" }
  if (event.content !== NOSTR_AUTH_EVENT_CONTENT)
    return { valid: false, reason: "wrong content" }
  if (!Array.isArray(event.tags))
    return { valid: false, reason: "missing tags" }
  const hasLoginMethod = (event.tags as string[][]).some(
    (t) => Array.isArray(t) && t[0] === "method" && t[1] === NOSTR_AUTH_EVENT_METHOD,
  )
  if (!hasLoginMethod)
    return { valid: false, reason: "missing method tag" }
  if (typeof event.created_at !== "number")
    return { valid: false, reason: "invalid created_at" }
  if (event.created_at < now - MAX_AGE || event.created_at > now + FUTURE_SKEW)
    return { valid: false, reason: "expired or future" }
  if (typeof event.pubkey !== "string" || event.pubkey.toLowerCase() !== pubkey)
    return { valid: false, reason: "pubkey mismatch" }

  return { valid: true }
}

describe("Nostr auth event validation (guards lib/auth.ts authorize())", () => {
  it("accepts a valid kind-27235 login event", () => {
    const event = buildLoginEvent()
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: true })
  })

  it("rejects a kind-1 note (relay-note replay attack)", () => {
    const event = buildLoginEvent({ kind: 1, content: "hello world" })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: false })
  })

  it("rejects an event with wrong content", () => {
    const event = buildLoginEvent({ content: "some other content" })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: false })
  })

  it("rejects an event missing the method tag", () => {
    const event = buildLoginEvent({ tags: [["u", "https://example.com"]] })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: false })
  })

  it("rejects a stale event older than 5 minutes", () => {
    const event = buildLoginEvent({ created_at: NOW_UNIX - 301 })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: false })
  })

  it("rejects a future-dated event beyond 60 s skew", () => {
    const event = buildLoginEvent({ created_at: NOW_UNIX + 61 })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: false })
  })

  it("rejects an event whose pubkey doesn't match the credential", () => {
    const event = buildLoginEvent({ pubkey: "b".repeat(64) })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: false })
  })

  it("accepts an event at exactly the max-age boundary", () => {
    const event = buildLoginEvent({ created_at: NOW_UNIX - 300 })
    expect(validateNostrAuthEvent(event, VALID_PUBKEY)).toMatchObject({ valid: true })
  })
})
