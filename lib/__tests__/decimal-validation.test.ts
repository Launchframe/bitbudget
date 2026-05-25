// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  MAX_DECIMAL_12_2,
  MAX_DECIMAL_4_2,
  coerceDecimal12_2Input,
  validateDecimal12_2,
  validateDecimal4_2Positive,
} from "../decimal-validation"

describe("decimal-validation", () => {
  it("validateDecimal12_2 rounds to cents and enforces max", () => {
    expect(validateDecimal12_2(100.999, "targetAmount")).toEqual({ ok: true, value: 101 })
    expect(validateDecimal12_2(MAX_DECIMAL_12_2, "targetAmount")).toEqual({
      ok: true,
      value: MAX_DECIMAL_12_2,
    })
    expect(validateDecimal12_2(MAX_DECIMAL_12_2 + 0.01, "targetAmount").ok).toBe(false)
    expect(validateDecimal12_2(-1, "targetAmount").ok).toBe(false)
  })

  it("coerceDecimal12_2Input rejects empty strings before Number coercion", () => {
    expect(coerceDecimal12_2Input("", "targetAmount")).toEqual({
      ok: false,
      error: "targetAmount must be a number",
    })
    expect(coerceDecimal12_2Input("   ", "targetAmount")).toEqual({
      ok: false,
      error: "targetAmount must be a number",
    })
    expect(coerceDecimal12_2Input("250", "targetAmount")).toEqual({ ok: true, value: 250 })
    expect(coerceDecimal12_2Input("not-a-number", "targetAmount").ok).toBe(false)
  })

  it("validateDecimal4_2Positive enforces positive max", () => {
    expect(validateDecimal4_2Positive(1.255, "sweepCapMultiplier")).toEqual({
      ok: true,
      value: 1.25,
    })
    expect(validateDecimal4_2Positive(MAX_DECIMAL_4_2, "sweepCapMultiplier").ok).toBe(true)
    expect(validateDecimal4_2Positive(100, "sweepCapMultiplier").ok).toBe(false)
    expect(validateDecimal4_2Positive(0, "sweepCapMultiplier").ok).toBe(false)
  })
})
