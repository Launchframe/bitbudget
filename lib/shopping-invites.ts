/**
 * Invite token hashing and join verification codes.
 * The server stores only the token hash; the raw capability lives in URL fragments.
 *
 * Join codes are 64-bit hex secrets carried in the invite link and auto-filled on
 * accept — not spoken out of band. Human OOB comparison uses the key fingerprint.
 */

import { uint8ToHex } from "@/lib/crypto"

const TOKEN_BYTES = 32
/** Spoken-era 6-char codes from earlier builds (claim-time only). */
const LEGACY_VERIFY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const LEGACY_VERIFY_CODE_LEN = 6
/** Link-carried join secret: 64 bits as 16 lowercase hex. */
const JOIN_CODE_HEX_LEN = 16
const JOIN_CODE_RE = /^[0-9a-f]{16}$/
const LEGACY_VERIFY_RE = new RegExp(
  `^[${LEGACY_VERIFY_ALPHABET}]{${LEGACY_VERIFY_CODE_LEN}}$`,
)
const OWNER_PK_RE = /^[0-9a-f]{64}$/

function toBuffer(arr: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(arr.byteLength)
  new Uint8Array(buf).set(arr)
  return buf
}

export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export async function hashInviteToken(token: string): Promise<string> {
  if (typeof token !== "string" || token.length < 16 || token.length > 128) {
    throw new Error("Invalid invite token")
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid invite token")
  }
  const digest = await crypto.subtle.digest("SHA-256", toBuffer(new TextEncoder().encode(token)))
  return uint8ToHex(new Uint8Array(digest))
}

/** 64-bit join secret for the invite URL (machine-filled on accept). */
export function generateInviteJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_HEX_LEN / 2))
  return uint8ToHex(bytes)
}

/** @deprecated Prefer {@link generateInviteJoinCode}; kept for tests / legacy callers. */
export function generateRequestVerificationCode(): string {
  return generateInviteJoinCode()
}

export function isRequestVerificationCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (JOIN_CODE_RE.test(value) || LEGACY_VERIFY_RE.test(value))
  )
}

export function isInviteJoinCode(value: unknown): value is string {
  return typeof value === "string" && JOIN_CODE_RE.test(value)
}

export interface ShoppingInviteFragment {
  token: string
  joinCode: string | null
  ownerPublicKey: string | null
}

/**
 * Same-origin invite URL. Token + join code belong in the fragment so they are
 * not logged as a path/query. Format: `#token.joinCode` or `#token.joinCode.ownerPk`.
 */
export function shoppingInviteUrl(
  origin: string,
  token: string,
  ownerPublicKey?: string | null,
  joinCode?: string | null,
): string {
  const base = origin.replace(/\/+$/, "")
  const encoded = encodeURIComponent(token)
  const code = joinCode && isInviteJoinCode(joinCode) ? joinCode : null
  const pk = ownerPublicKey && OWNER_PK_RE.test(ownerPublicKey) ? ownerPublicKey : null
  if (code && pk) return `${base}/shopping-invite#${encoded}.${code}.${pk}`
  if (code) return `${base}/shopping-invite#${encoded}.${code}`
  // Legacy links without a join code (should not be created going forward).
  return pk ? `${base}/shopping-invite#${encoded}.${pk}` : `${base}/shopping-invite#${encoded}`
}

/** Parse invite fragment into token (+ optional join code / owner pubkey). */
export function parseInviteFragmentParts(hash: string): ShoppingInviteFragment | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw) return null
  const parts = raw.split(".")
  let token = parts[0] ?? ""
  try {
    token = decodeURIComponent(token)
  } catch {
    return null
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null

  let joinCode: string | null = null
  let ownerPublicKey: string | null = null
  const second = parts[1] ?? ""
  const third = parts[2] ?? ""

  if (JOIN_CODE_RE.test(second)) {
    joinCode = second
    if (OWNER_PK_RE.test(third)) ownerPublicKey = third
  } else if (OWNER_PK_RE.test(second)) {
    // Legacy `#token.ownerPk` (no join code in the link).
    ownerPublicKey = second
  }

  return { token, joinCode, ownerPublicKey }
}

/** @deprecated Prefer {@link parseInviteFragmentParts}. */
export function parseInviteFragment(hash: string): string | null {
  return parseInviteFragmentParts(hash)?.token ?? null
}
