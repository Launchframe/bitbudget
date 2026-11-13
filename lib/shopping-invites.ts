/**
 * Invite token hashing and request verification codes.
 * The server stores only the token hash; the raw capability lives in URL fragments.
 */

import { uint8ToHex } from "@/lib/crypto"

const TOKEN_BYTES = 32
const VERIFY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const VERIFY_CODE_LEN = 6

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

export function generateRequestVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(VERIFY_CODE_LEN))
  let out = ""
  for (const b of bytes) {
    out += VERIFY_ALPHABET[b % VERIFY_ALPHABET.length]
  }
  return out
}

export function isRequestVerificationCode(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[${VERIFY_ALPHABET}]{${VERIFY_CODE_LEN}}$`).test(value)
}

/** Same-origin invite URL. Token belongs in the fragment so it is not logged as a path/query. */
export function shoppingInviteUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "")
  return `${base}/shopping-invite#${encodeURIComponent(token)}`
}

export function parseInviteFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw) return null
  let token = raw
  try {
    token = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null
  return token
}
