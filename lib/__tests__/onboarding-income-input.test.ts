// @vitest-environment node
import { describe, expect, it } from "vitest"
import { normalizeUsdDraftInput, parseUsdDraftInput } from "../onboarding-income-input"

describe("onboarding-income-input", () => {
  it("normalizeUsdDraftInput strips leading zeros", () => {
    expect(normalizeUsdDraftInput("001000000")).toBe("1000000")
    expect(normalizeUsdDraftInput("000100000")).toBe("100000")
    expect(normalizeUsdDraftInput("00")).toBe("0")
    expect(normalizeUsdDraftInput("0")).toBe("0")
  })

  it("normalizeUsdDraftInput preserves decimals in progress", () => {
    expect(normalizeUsdDraftInput("2500.5")).toBe("2500.5")
    expect(normalizeUsdDraftInput("2500.")).toBe("2500.")
    expect(normalizeUsdDraftInput(".5")).toBe("0.5")
    expect(normalizeUsdDraftInput("00.50")).toBe("0.50")
  })

  it("normalizeUsdDraftInput removes non-numeric characters", () => {
    expect(normalizeUsdDraftInput("$2,500.00")).toBe("2500.00")
  })

  it("parseUsdDraftInput returns null for empty or incomplete", () => {
    expect(parseUsdDraftInput("")).toBeNull()
    expect(parseUsdDraftInput("2500.")).toBeNull()
    expect(parseUsdDraftInput("0")).toBeNull()
  })

  it("parseUsdDraftInput returns positive amounts", () => {
    expect(parseUsdDraftInput("001000000")).toBe(1_000_000)
    expect(parseUsdDraftInput("2500.55")).toBe(2500.55)
  })
})
