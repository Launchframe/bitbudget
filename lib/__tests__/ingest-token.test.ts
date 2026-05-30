import { describe, expect, it } from "vitest"
import {
  extractIngestTokenFromRequest,
  generateIngestToken,
  ingestTokenMatches,
} from "@/lib/ingest-token"

describe("ingest-token", () => {
  it("generateIngestToken returns 32 hex chars", () => {
    const t = generateIngestToken()
    expect(t).toMatch(/^[a-f0-9]{32}$/)
  })

  it("ingestTokenMatches is timing-safe equal", () => {
    const t = generateIngestToken()
    expect(ingestTokenMatches(t, t)).toBe(true)
    expect(ingestTokenMatches(t, t + "x")).toBe(false)
    expect(ingestTokenMatches(t, null)).toBe(false)
  })

  it("extractIngestTokenFromRequest prefers custom header", () => {
    expect(
      extractIngestTokenFromRequest("Bearer wrong", "correct"),
    ).toBe("correct")
  })

  it("extractIngestTokenFromRequest parses Bearer", () => {
    expect(extractIngestTokenFromRequest("Bearer abc", null)).toBe("abc")
  })
})
