// @vitest-environment node
import { describe, expect, it } from "vitest"
import { isBudgetEnvelope, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "../constants"

describe("isBudgetEnvelope", () => {
  it("treats null/undefined systemRole as budget envelopes", () => {
    expect(isBudgetEnvelope(null)).toBe(true)
    expect(isBudgetEnvelope(undefined)).toBe(true)
  })

  it("excludes system Savings only", () => {
    expect(isBudgetEnvelope(SYSTEM_ENVELOPE_ROLE_SAVINGS)).toBe(false)
    expect(isBudgetEnvelope("other")).toBe(true)
  })
})
