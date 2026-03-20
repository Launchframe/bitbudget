// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { generateSecretKey } from "nostr-tools"
import { nsecEncode } from "nostr-tools/nip19"

const mockGet = vi.fn()
const mockClose = vi.fn()

vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    get = mockGet
    close = mockClose
  },
}))

import {
  buildAuthEventTemplate,
  decodeNsec,
  signAuthEvent,
  fetchNostrProfile,
  type AuthEventTemplate,
} from "../nostr-local-signer"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

beforeEach(() => {
  mockGet.mockReset()
  mockClose.mockReset()
})

describe("buildAuthEventTemplate", () => {
  it("returns kind 27235", () => {
    const t = buildAuthEventTemplate("https://app.example.com")
    expect(t.kind).toBe(27235)
  })

  it("includes origin in u tag", () => {
    const origin = "https://bitbudget.app"
    const t = buildAuthEventTemplate(origin)
    const uTag = t.tags.find(([name]) => name === "u")
    expect(uTag).toEqual(["u", origin])
  })

  it("includes method login tag", () => {
    const t = buildAuthEventTemplate("https://example.com")
    const methodTag = t.tags.find(([name]) => name === "method")
    expect(methodTag).toEqual(["method", "login"])
  })

  it("content is BitBudget Login", () => {
    const t = buildAuthEventTemplate("https://example.com")
    expect(t.content).toBe("BitBudget Login")
  })

  it("created_at is near now (within 2s)", () => {
    const before = Math.floor(Date.now() / 1000)
    const t = buildAuthEventTemplate("https://example.com")
    const after = Math.floor(Date.now() / 1000)
    expect(t.created_at).toBeGreaterThanOrEqual(before)
    expect(t.created_at).toBeLessThanOrEqual(after + 1)
  })

  it("matches AuthEventTemplate shape (no required pubkey)", () => {
    const t = buildAuthEventTemplate("https://x.com") as AuthEventTemplate
    expect(t).toHaveProperty("kind")
    expect(t).toHaveProperty("created_at")
    expect(t).toHaveProperty("tags")
    expect(t).toHaveProperty("content")
    expect(Array.isArray(t.tags)).toBe(true)
  })
})

describe("decodeNsec", () => {
  it("decodes valid nsec to secretKey and pubkey", () => {
    const secretKey = generateSecretKey()
    const nsec = nsecEncode(secretKey)
    const result = decodeNsec(nsec)
    expect(result.secretKey).toEqual(secretKey)
    expect(result.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it("trims whitespace", () => {
    const secretKey = generateSecretKey()
    const nsec = nsecEncode(secretKey)
    const result = decodeNsec(`  ${nsec}  `)
    expect(result.secretKey).toEqual(secretKey)
  })

  it("throws if string does not start with nsec1", () => {
    expect(() => decodeNsec("npub1something")).toThrow("Invalid nsec: must start with nsec1")
    expect(() => decodeNsec("")).toThrow("Invalid nsec: must start with nsec1")
  })

  it("throws if decoded type is not nsec", () => {
    expect(() => decodeNsec("nsec1invalid")).toThrow()
  })
})

describe("signAuthEvent", () => {
  it("returns event with id, sig, and pubkey", () => {
    const secretKey = generateSecretKey()
    const signed = signAuthEvent(secretKey, "https://app.example.com")
    expect(signed).toHaveProperty("id")
    expect(signed).toHaveProperty("sig")
    expect(signed).toHaveProperty("pubkey")
    expect(typeof signed.id).toBe("string")
    expect(typeof signed.sig).toBe("string")
    expect(signed.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it("uses same kind and content as template", () => {
    const secretKey = generateSecretKey()
    const signed = signAuthEvent(secretKey, "https://example.com")
    expect(signed.kind).toBe(27235)
    expect(signed.content).toBe("BitBudget Login")
    expect(signed.tags).toContainEqual(["u", "https://example.com"])
    expect(signed.tags).toContainEqual(["method", "login"])
  })

  it("produces different id/sig for different origins", () => {
    const secretKey = generateSecretKey()
    const a = signAuthEvent(secretKey, "https://a.com")
    const b = signAuthEvent(secretKey, "https://b.com")
    expect(a.id).not.toBe(b.id)
    expect(a.sig).not.toBe(b.sig)
  })
})

describe("fetchNostrProfile", () => {
  const pk = "0".repeat(64)

  it("returns {} when pool returns no event", async () => {
    mockGet.mockResolvedValue(null)
    const profile = await fetchNostrProfile(pk)
    expect(profile).toEqual({})
    expect(mockClose).toHaveBeenCalled()
  })

  it("parses kind 0 content for name and image", async () => {
    mockGet.mockResolvedValue({
      content: JSON.stringify({ display_name: "Alice", picture: "https://example.com/p.png" }),
    })
    const profile = await fetchNostrProfile(pk)
    expect(profile).toEqual({ name: "Alice", image: "https://example.com/p.png" })
    expect(mockClose).toHaveBeenCalled()
  })

  it("closes pool when get rejects (no connection leak)", async () => {
    mockGet.mockRejectedValue(new Error("relay down"))
    const profile = await fetchNostrProfile(pk)
    expect(profile).toEqual({})
    expect(mockClose).toHaveBeenCalled()
  })
})
