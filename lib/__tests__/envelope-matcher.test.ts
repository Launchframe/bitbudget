// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    payeeEnvelopeMapping: {
      findUnique: vi.fn(),
    },
    envelope: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import { normalizePayee, hashPayee, matchByHistory, matchByLLM } from "../envelope-matcher"

describe("normalizePayee", () => {
  it("lowercases and trims", () => {
    expect(normalizePayee("  Starbucks  ")).toBe("starbucks")
  })

  it("strips common suffixes", () => {
    expect(normalizePayee("TRADER JOE'S #123")).toBe("trader joe's")
  })

  it("collapses whitespace", () => {
    expect(normalizePayee("Blue   Bottle  Coffee")).toBe("blue bottle coffee")
  })
})

describe("hashPayee", () => {
  it("produces consistent hashes", () => {
    const a = hashPayee("starbucks")
    const b = hashPayee("starbucks")
    expect(a).toBe(b)
  })

  it("produces different hashes for different inputs", () => {
    expect(hashPayee("starbucks")).not.toBe(hashPayee("peets"))
  })

  it("returns a hex string", () => {
    expect(hashPayee("test")).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("matchByHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns match with high confidence when mapping exists", async () => {
    const mockFindUnique = prisma.payeeEnvelopeMapping.findUnique as ReturnType<typeof vi.fn>
    mockFindUnique.mockResolvedValue({
      envelopeId: "env-123",
      count: 5,
    })

    const result = await matchByHistory("user-1", "Starbucks")
    expect(result).toEqual({ envelopeId: "env-123", confidence: 0.95 })
  })

  it("returns null when no mapping exists", async () => {
    const mockFindUnique = prisma.payeeEnvelopeMapping.findUnique as ReturnType<typeof vi.fn>
    mockFindUnique.mockResolvedValue(null)

    const result = await matchByHistory("user-1", "New Place")
    expect(result).toBeNull()
  })
})

describe("matchByLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", vi.fn())
  })

  it("returns null when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY

    const mockFindMany = prisma.envelope.findMany as ReturnType<typeof vi.fn>
    mockFindMany.mockResolvedValue([{ id: "env-1", name: "Groceries" }])

    const result = await matchByLLM("user-1", "Trader Joes")
    expect(result).toBeNull()
  })

  it("parses LLM response and returns match", async () => {
    process.env.OPENAI_API_KEY = "test-key"

    const mockFindMany = prisma.envelope.findMany as ReturnType<typeof vi.fn>
    mockFindMany.mockResolvedValue([
      { id: "env-1", name: "Groceries" },
      { id: "env-2", name: "Dining Out" },
    ])

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '{"envelope":"Groceries","confidence":0.8}',
              },
            },
          ],
        }),
    })

    const result = await matchByLLM("user-1", "Trader Joes")
    expect(result).toEqual({ envelopeId: "env-1", confidence: 0.6 })
  })

  it("returns null when LLM response doesn't match any envelope", async () => {
    process.env.OPENAI_API_KEY = "test-key"

    const mockFindMany = prisma.envelope.findMany as ReturnType<typeof vi.fn>
    mockFindMany.mockResolvedValue([{ id: "env-1", name: "Groceries" }])

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '{"envelope":"Unknown Category","confidence":0.3}',
              },
            },
          ],
        }),
    })

    const result = await matchByLLM("user-1", "Trader Joes")
    expect(result).toBeNull()
  })
})
