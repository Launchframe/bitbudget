import { describe, expect, it } from "vitest"
import {
  DEFAULT_RISK_ANSWERS,
  MAX_CASH_FLOOR_MONTHS,
  baseCashFloorMonths,
  recommendBorrowCapFraction,
  recommendCashFloorMonths,
  recommendedCashFloorUsd,
  resolveRiskAnswers,
  resolveRiskProfile,
  targetBtcShare,
  type RiskAnswers,
} from "../runway-risk"

describe("DEFAULT_RISK_ANSWERS", () => {
  it("is the balanced middle path", () => {
    expect(DEFAULT_RISK_ANSWERS).toEqual({
      dipResponse: "cut",
      btcSharePreference: "half",
      borrowStance: "deep_drop",
    })
  })
})

describe("targetBtcShare", () => {
  it("maps each preference to a share", () => {
    expect(targetBtcShare({ ...DEFAULT_RISK_ANSWERS, btcSharePreference: "little" })).toBe(0.2)
    expect(targetBtcShare({ ...DEFAULT_RISK_ANSWERS, btcSharePreference: "half" })).toBe(0.5)
    expect(targetBtcShare({ ...DEFAULT_RISK_ANSWERS, btcSharePreference: "most" })).toBe(0.8)
  })
})

describe("baseCashFloorMonths", () => {
  it("maps each dip response to months of monthly draw", () => {
    expect(baseCashFloorMonths({ ...DEFAULT_RISK_ANSWERS, dipResponse: "sell" })).toBe(12)
    expect(baseCashFloorMonths({ ...DEFAULT_RISK_ANSWERS, dipResponse: "cut" })).toBe(6)
    expect(baseCashFloorMonths({ ...DEFAULT_RISK_ANSWERS, dipResponse: "wait" })).toBe(3)
  })
})

describe("recommendBorrowCapFraction", () => {
  it("maps each borrow stance to a fraction of bitcoin value", () => {
    expect(recommendBorrowCapFraction({ ...DEFAULT_RISK_ANSWERS, borrowStance: "never" })).toBe(0)
    expect(recommendBorrowCapFraction({ ...DEFAULT_RISK_ANSWERS, borrowStance: "deep_drop" })).toBe(
      0.25,
    )
    expect(recommendBorrowCapFraction({ ...DEFAULT_RISK_ANSWERS, borrowStance: "ok" })).toBe(0.4)
  })
})

describe("recommendCashFloorMonths", () => {
  const cut: RiskAnswers = { ...DEFAULT_RISK_ANSWERS, dipResponse: "cut" }

  it("returns the base months when not over-allocated to bitcoin", () => {
    expect(recommendCashFloorMonths(cut, 0.5, 0.5)).toBe(6)
    expect(recommendCashFloorMonths(cut, 0.3, 0.5)).toBe(6)
  })

  it("adds a cushion when actual bitcoin share exceeds target", () => {
    // 20pp over target → ceil(0.20 * 10) = 2 extra months → 6 + 2 = 8
    expect(recommendCashFloorMonths(cut, 0.7, 0.5)).toBe(8)
    // 10pp over → +1
    expect(recommendCashFloorMonths(cut, 0.6, 0.5)).toBe(7)
  })

  it("caps the extra cushion at +6 months", () => {
    const wait: RiskAnswers = { ...DEFAULT_RISK_ANSWERS, dipResponse: "wait" }
    // 80pp over → ceil(8) = 8 but capped to +6 → base 3 + 6 = 9
    expect(recommendCashFloorMonths(wait, 1, 0.2)).toBe(9)
  })

  it("caps the total at MAX_CASH_FLOOR_MONTHS (18)", () => {
    const sell: RiskAnswers = { ...DEFAULT_RISK_ANSWERS, dipResponse: "sell" }
    // base 12 + capped +6 = 18
    expect(recommendCashFloorMonths(sell, 1, 0.2)).toBe(MAX_CASH_FLOOR_MONTHS)
    expect(recommendCashFloorMonths(sell, 1, 0.2)).toBe(18)
  })

  it("does not add a phantom month when the gap is exactly 30 percentage points", () => {
    // 0.8 and 0.5 are the "most" and "half" targets. (0.8 - 0.5) * 10 is
    // 3.0000000000000004 in IEEE, and a raw ceil of that is 4.
    expect(recommendCashFloorMonths(cut, 0.8, 0.5)).toBe(9)
  })

  it("still rounds a partial block up", () => {
    // 1pp over target is not a full extra month of the formula's 10pp unit,
    // but ceil means any overage in the block adds one month: 6 + 1.
    expect(recommendCashFloorMonths(cut, 0.51, 0.5)).toBe(7)
  })

  it("ignores a non-finite share instead of adding a cushion", () => {
    expect(recommendCashFloorMonths(cut, Number.NaN, 0.5)).toBe(6)
    expect(recommendCashFloorMonths(cut, 0.9, Number.NaN)).toBe(6)
  })
})

describe("resolveRiskAnswers", () => {
  it("fills defaults for null / undefined", () => {
    expect(resolveRiskAnswers(null)).toEqual(DEFAULT_RISK_ANSWERS)
    expect(resolveRiskAnswers(undefined)).toEqual(DEFAULT_RISK_ANSWERS)
  })

  it("fills only the missing fields of a partial answer set", () => {
    expect(resolveRiskAnswers({ dipResponse: "sell" })).toEqual({
      dipResponse: "sell",
      btcSharePreference: "half",
      borrowStance: "deep_drop",
    })
  })
})

describe("resolveRiskProfile", () => {
  it("derives target share, base months, and borrow cap from defaults", () => {
    const profile = resolveRiskProfile(null)
    expect(profile.answers).toEqual(DEFAULT_RISK_ANSWERS)
    expect(profile.targetBtcShare).toBe(0.5)
    expect(profile.cashFloorMonthsBase).toBe(6)
    expect(profile.borrowCapFraction).toBe(0.25)
  })

  it("reflects a fully specified answer set", () => {
    const profile = resolveRiskProfile({
      dipResponse: "wait",
      btcSharePreference: "most",
      borrowStance: "ok",
    })
    expect(profile.targetBtcShare).toBe(0.8)
    expect(profile.cashFloorMonthsBase).toBe(3)
    expect(profile.borrowCapFraction).toBe(0.4)
  })
})

describe("recommendedCashFloorUsd", () => {
  it("is months × monthly draw", () => {
    expect(recommendedCashFloorUsd(6, 2000)).toBe(12000)
  })

  it("is zero when the monthly draw is zero or negative", () => {
    expect(recommendedCashFloorUsd(6, 0)).toBe(0)
    expect(recommendedCashFloorUsd(6, -100)).toBe(0)
  })
})
