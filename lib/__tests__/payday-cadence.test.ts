// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  fundingPeriodKeyForPayday,
  isPaydayForUser,
  PAYDAY_LAST_OF_MONTH,
  sweepPeriodKeyForPayday,
  usesPaydayCadence,
  type PaydayUserFields,
} from "../payday-cadence"

function user(overrides: Partial<PaydayUserFields> = {}): PaydayUserFields {
  return {
    payCadence: "monthly",
    payDays: [],
    payDayOfWeek: null,
    lastPaydayAt: null,
    ...overrides,
  }
}

describe("payday-cadence", () => {
  it("isPaydayForUser monthly defaults to 1st when payDays empty", () => {
    const first = new Date(Date.UTC(2026, 4, 1))
    const second = new Date(Date.UTC(2026, 4, 2))
    expect(isPaydayForUser(user({ payCadence: "monthly" }), first)).toBe(true)
    expect(isPaydayForUser(user({ payCadence: "monthly" }), second)).toBe(false)
  })

  it("isPaydayForUser monthly honors configured payDays", () => {
    const run = new Date(Date.UTC(2026, 4, 15))
    expect(isPaydayForUser(user({ payDays: [1, 15] }), run)).toBe(true)
    expect(isPaydayForUser(user({ payDays: [1] }), run)).toBe(false)
  })

  it("isPaydayForUser monthly maps last-of-month sentinel", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31))
    const feb28 = new Date(Date.UTC(2026, 1, 28))
    expect(isPaydayForUser(user({ payDays: [PAYDAY_LAST_OF_MONTH] }), jan31)).toBe(true)
    expect(isPaydayForUser(user({ payDays: [PAYDAY_LAST_OF_MONTH] }), feb28)).toBe(true)
  })

  it("isPaydayForUser bimonthly defaults to 1st and 16th when payDays empty", () => {
    const first = new Date(Date.UTC(2026, 4, 1))
    const mid = new Date(Date.UTC(2026, 4, 15))
    const secondHalf = new Date(Date.UTC(2026, 4, 16))
    expect(isPaydayForUser(user({ payCadence: "bimonthly" }), first)).toBe(true)
    expect(isPaydayForUser(user({ payCadence: "bimonthly" }), mid)).toBe(false)
    expect(isPaydayForUser(user({ payCadence: "bimonthly" }), secondHalf)).toBe(true)
  })

  it("isPaydayForUser bimonthly uses two configured days", () => {
    const mid = new Date(Date.UTC(2026, 2, 15))
    const other = new Date(Date.UTC(2026, 2, 16))
    expect(isPaydayForUser(user({ payCadence: "bimonthly", payDays: [1, 15] }), mid)).toBe(true)
    expect(isPaydayForUser(user({ payCadence: "bimonthly", payDays: [1, 15] }), other)).toBe(false)
  })

  it("isPaydayForUser weekly matches payDayOfWeek", () => {
    const friday = new Date(Date.UTC(2026, 4, 8))
    expect(friday.getUTCDay()).toBe(5)
    expect(isPaydayForUser(user({ payCadence: "weekly", payDayOfWeek: 5 }), friday)).toBe(true)
    expect(isPaydayForUser(user({ payCadence: "weekly", payDayOfWeek: 1 }), friday)).toBe(false)
  })

  it("isPaydayForUser biweekly requires 14-day anchor alignment", () => {
    const anchor = new Date(Date.UTC(2026, 0, 2))
    const payday = new Date(Date.UTC(2026, 0, 16))
    expect(isPaydayForUser(user({ payCadence: "biweekly", payDayOfWeek: 5, lastPaydayAt: anchor }), payday)).toBe(
      true,
    )
    expect(isPaydayForUser(user({ payCadence: "biweekly", payDayOfWeek: 5, lastPaydayAt: anchor }), anchor)).toBe(
      true,
    )
    const offWeek = new Date(Date.UTC(2026, 0, 9))
    expect(isPaydayForUser(user({ payCadence: "biweekly", payDayOfWeek: 5, lastPaydayAt: anchor }), offWeek)).toBe(
      false,
    )
  })

  it("isPaydayForUser returns false for irregular and mixed", () => {
    const run = new Date(Date.UTC(2026, 4, 1))
    expect(isPaydayForUser(user({ payCadence: "irregular" }), run)).toBe(false)
    expect(isPaydayForUser(user({ payCadence: "mixed" }), run)).toBe(false)
  })

  it("fundingPeriodKeyForPayday is date-specific", () => {
    const run = new Date(Date.UTC(2026, 4, 15))
    expect(fundingPeriodKeyForPayday(user(), run)).toBe("fund-2026-05-15")
    expect(sweepPeriodKeyForPayday(user(), run)).toBe("sweep-2026-05-15")
  })

  it("usesPaydayCadence is true when payDays configured or cadence is weekly/biweekly/daily", () => {
    expect(usesPaydayCadence(user())).toBe(false)
    expect(usesPaydayCadence(user({ payDays: [1, 15] }))).toBe(true)
    expect(usesPaydayCadence(user({ payCadence: "weekly" }))).toBe(true)
    expect(usesPaydayCadence(user({ payCadence: "biweekly" }))).toBe(true)
    expect(usesPaydayCadence(user({ payCadence: "daily" }))).toBe(true)
    expect(usesPaydayCadence(user({ payCadence: "monthly" }))).toBe(false)
  })
})
