// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/envelope-sweep", () => ({ createManualDeficitCover: vi.fn() }))

import { parseEntries } from "@/app/api/transactions/envelope-deficit-cover/route"

describe("parseEntries (deficit-cover route input validation)", () => {
  it("returns null for non-object bodies", () => {
    expect(parseEntries(null)).toBeNull()
    expect(parseEntries("string")).toBeNull()
    expect(parseEntries([])).toBeNull()
  })

  it("returns null when entries is missing or not an array", () => {
    expect(parseEntries({})).toBeNull()
    expect(parseEntries({ entries: null })).toBeNull()
    expect(parseEntries({ entries: "bad" })).toBeNull()
  })

  it("returns null for empty entries array", () => {
    expect(parseEntries({ entries: [] })).toBeNull()
  })

  it("returns null when any entry has empty or non-string envelopeId", () => {
    expect(parseEntries({ entries: [{ envelopeId: "", amount: 10 }] })).toBeNull()
    expect(parseEntries({ entries: [{ envelopeId: 123, amount: 10 }] })).toBeNull()
  })

  it("returns null when any entry has non-positive amount", () => {
    expect(parseEntries({ entries: [{ envelopeId: "env1", amount: 0 }] })).toBeNull()
    expect(parseEntries({ entries: [{ envelopeId: "env1", amount: -5 }] })).toBeNull()
    expect(parseEntries({ entries: [{ envelopeId: "env1", amount: NaN }] })).toBeNull()
  })

  it("returns null when any entry is not an object", () => {
    expect(parseEntries({ entries: [null] })).toBeNull()
    expect(parseEntries({ entries: ["env1"] })).toBeNull()
  })

  it("accepts a valid entries array and trims envelopeId", () => {
    const result = parseEntries({
      entries: [
        { envelopeId: "  env-abc  ", amount: 25.5 },
        { envelopeId: "env-def", amount: 10 },
      ],
    })
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result![0]).toEqual({ envelopeId: "env-abc", amount: 25.5 })
    expect(result![1]).toEqual({ envelopeId: "env-def", amount: 10 })
  })

  it("coerces string amount to number", () => {
    const result = parseEntries({
      entries: [{ envelopeId: "env1", amount: "30" }],
    })
    expect(result).not.toBeNull()
    expect(result![0]!.amount).toBe(30)
  })
})
