import { webcrypto } from "node:crypto"
import { describe, it, expect, afterAll } from "vitest"
import { generateSecretKey, verifyEvent } from "nostr-tools"
import { signAuthEvent } from "@/lib/nostr-local-signer"
import { parseNostrAuthEvent } from "@/lib/sign-in-methods"
import { prisma } from "@/lib/db"

if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  })
}

describe("nostr login event (extension-shaped)", () => {
  it("parse + verify succeeds for localhost origin", () => {
    const sk = generateSecretKey()
    const signed = signAuthEvent(sk, "http://localhost:3001")
    const parsed = parseNostrAuthEvent(JSON.stringify(signed), signed.pubkey)
    expect(verifyEvent(parsed)).toBe(true)
  })

  it("parse + verify when extension returns created_at as a numeric string", () => {
    const sk = generateSecretKey()
    const signed = signAuthEvent(sk, "http://localhost:3001")
    const withStringTs = { ...signed, created_at: String(signed.created_at) }
    const parsed = parseNostrAuthEvent(JSON.stringify(withStringTs), signed.pubkey)
    expect(verifyEvent(parsed)).toBe(true)
  })

  it("can create a nostr-only user row (authorize DB path)", async () => {
    const pubkey = `test${Date.now().toString(16)}`.padEnd(64, "b").slice(0, 64)
    const user = await prisma.user.create({
      data: {
        nostrPubkey: pubkey,
        name: `nostr:${pubkey.slice(0, 8)}`,
      },
    })
    expect(user.id).toBeTruthy()
    await prisma.user.delete({ where: { id: user.id } })
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
