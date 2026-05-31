// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/move-funds", () => ({ createMoveFundsBatch: vi.fn() }))

import { parseBody } from "@/app/api/transactions/move-funds/route"

describe("parseBody (move-funds route input validation)", () => {
  it("returns null for non-object bodies", () => {
    expect(parseBody(null)).toBeNull()
    expect(parseBody("string")).toBeNull()
    expect(parseBody([])).toBeNull()
    expect(parseBody(42)).toBeNull()
  })

  it("returns null when mode is missing or invalid", () => {
    expect(parseBody({ entries: [], mode: "wrong" })).toBeNull()
    expect(parseBody({ entries: [] })).toBeNull()
  })

  it("returns null when entries is not an array", () => {
    expect(parseBody({ mode: "independent", entries: null })).toBeNull()
    expect(parseBody({ mode: "balanced", entries: {} })).toBeNull()
  })

  it("returns null for an empty entries array", () => {
    expect(parseBody({ mode: "independent", entries: [] })).toBeNull()
  })

  it("returns null when any entry has invalid envelopeId", () => {
    expect(parseBody({ mode: "independent", entries: [{ envelopeId: "", deltaUsd: 10 }] })).toBeNull()
    expect(parseBody({ mode: "independent", entries: [{ envelopeId: 123, deltaUsd: 10 }] })).toBeNull()
  })

  it("returns null when any entry has zero or non-finite deltaUsd", () => {
    expect(parseBody({ mode: "independent", entries: [{ envelopeId: "env1", deltaUsd: 0 }] })).toBeNull()
    expect(parseBody({ mode: "independent", entries: [{ envelopeId: "env1", deltaUsd: NaN }] })).toBeNull()
    expect(parseBody({ mode: "independent", entries: [{ envelopeId: "env1", deltaUsd: Infinity }] })).toBeNull()
  })

  it("returns null when any entry is not an object", () => {
    expect(parseBody({ mode: "independent", entries: ["env1"] })).toBeNull()
  })

  it("accepts valid independent mode", () => {
    const result = parseBody({
      mode: "independent",
      entries: [
        { envelopeId: "env1", deltaUsd: 50 },
        { envelopeId: "env2", deltaUsd: -25 },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.mode).toBe("independent")
    expect(result!.entries).toHaveLength(2)
    expect(result!.entries[0]).toEqual({ envelopeId: "env1", deltaUsd: 50 })
  })

  it("accepts valid balanced mode", () => {
    const result = parseBody({
      mode: "balanced",
      entries: [{ envelopeId: "  env-abc  ", deltaUsd: 100 }],
    })
    expect(result).not.toBeNull()
    expect(result!.mode).toBe("balanced")
    // trims envelopeId whitespace
    expect(result!.entries[0]!.envelopeId).toBe("env-abc")
  })

  it("coerces string deltaUsd to number", () => {
    const result = parseBody({
      mode: "independent",
      entries: [{ envelopeId: "env1", deltaUsd: "75.50" }],
    })
    expect(result).not.toBeNull()
    expect(result!.entries[0]!.deltaUsd).toBe(75.5)
  })
})
