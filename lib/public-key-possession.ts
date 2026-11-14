/**
 * Stateless proof-of-possession for NaCl box public keys.
 * Server seals a random challenge to the claimed key; the client must decrypt it.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { encryptFieldForUser } from "@/lib/server-encrypt"

const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/
const CHALLENGE_TTL_MS = 5 * 60 * 1000

export function isPublicKeyHex(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_KEY_HEX_RE.test(value)
}

function macSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is required for public-key possession proofs")
  }
  return secret
}

function signPayload(publicKeyHex: string, challenge: string, exp: number): string {
  return createHmac("sha256", macSecret())
    .update(`${publicKeyHex}|${challenge}|${exp}`)
    .digest("hex")
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex")
    const bb = Buffer.from(b, "hex")
    return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

export function issuePublicKeyPossessionChallenge(publicKeyHex: string): {
  challengeToken: string
  sealedChallenge: string
} {
  if (!isPublicKeyHex(publicKeyHex)) {
    throw new Error("Invalid public key")
  }
  const challenge = randomBytes(32).toString("hex")
  const exp = Date.now() + CHALLENGE_TTL_MS
  const mac = signPayload(publicKeyHex, challenge, exp)
  const challengeToken = Buffer.from(
    JSON.stringify({ publicKeyHex, challenge, exp, mac }),
    "utf8",
  ).toString("base64url")
  const sealedChallenge = encryptFieldForUser(challenge, publicKeyHex)
  if (!sealedChallenge) {
    throw new Error("Failed to seal possession challenge")
  }
  return { challengeToken, sealedChallenge }
}

export function verifyPublicKeyPossession(params: {
  publicKeyHex: string
  challengeToken: string
  challenge: string
}): boolean {
  if (!isPublicKeyHex(params.publicKeyHex)) return false
  if (typeof params.challengeToken !== "string" || typeof params.challenge !== "string") {
    return false
  }
  if (!/^[0-9a-f]{64}$/.test(params.challenge)) return false

  let parsed: { publicKeyHex?: unknown; challenge?: unknown; exp?: unknown; mac?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(params.challengeToken, "base64url").toString("utf8")) as {
      publicKeyHex?: unknown
      challenge?: unknown
      exp?: unknown
      mac?: unknown
    }
  } catch {
    return false
  }

  if (
    typeof parsed.publicKeyHex !== "string" ||
    typeof parsed.challenge !== "string" ||
    typeof parsed.exp !== "number" ||
    typeof parsed.mac !== "string"
  ) {
    return false
  }
  if (parsed.publicKeyHex !== params.publicKeyHex) return false
  if (parsed.exp < Date.now()) return false

  const expectedMac = signPayload(parsed.publicKeyHex, parsed.challenge, parsed.exp)
  if (!safeEqualHex(expectedMac, parsed.mac)) return false
  return safeEqualHex(parsed.challenge, params.challenge)
}
