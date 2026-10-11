// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  isRecurringFundingFrequency,
  nextRunFromFrequency,
  RECURRING_FUNDING_FREQUENCIES,
} from "@/lib/recurring-funding-schedule"

describe("isRecurringFundingFrequency", () => {
  it("accepts known frequencies only", () => {
    for (const f of RECURRING_FUNDING_FREQUENCIES) {
      expect(isRecurringFundingFrequency(f)).toBe(true)
    }
    expect(isRecurringFundingFrequency("daily")).toBe(false)
  })
})

describe("nextRunFromFrequency", () => {
  const base = new Date(Date.UTC(2026, 0, 14, 12, 0, 0))

  it("weekly adds 7 days", () => {
    expect(nextRunFromFrequency("weekly", base).toISOString()).toBe("2026-01-21T12:00:00.000Z")
  })

  it("bimonthly adds 14 days", () => {
    expect(nextRunFromFrequency("bimonthly", base).toISOString()).toBe("2026-01-28T12:00:00.000Z")
  })

  it("monthly adds 1 calendar month", () => {
    expect(nextRunFromFrequency("monthly", base).toISOString()).toBe("2026-02-14T12:00:00.000Z")
  })

  it("every_2mo adds 2 months", () => {
    expect(nextRunFromFrequency("every_2mo", base).toISOString()).toBe("2026-03-14T12:00:00.000Z")
  })

  it("every_3mo adds 3 months", () => {
    expect(nextRunFromFrequency("every_3mo", base).toISOString()).toBe("2026-04-14T12:00:00.000Z")
  })

  it("every_6mo adds 6 months", () => {
    expect(nextRunFromFrequency("every_6mo", base).toISOString()).toBe("2026-07-14T12:00:00.000Z")
  })

  it("annually adds 12 months", () => {
    expect(nextRunFromFrequency("annually", base).toISOString()).toBe("2027-01-14T12:00:00.000Z")
  })

  it("unknown frequency defaults to monthly", () => {
    expect(nextRunFromFrequency("unknown", base).toISOString()).toBe("2026-02-14T12:00:00.000Z")
  })

  it("monthly from Jan 31 clamps to Feb 28 (not March 3)", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    const next = nextRunFromFrequency("monthly", jan31)
    // 2026 is not a leap year; last day of February is the 28th.
    expect(next.toISOString()).toBe("2026-02-28T12:00:00.000Z")
  })

  it("monthly from March 31 clamps to April 30 (not May 1)", () => {
    const mar31 = new Date(Date.UTC(2026, 2, 31, 12, 0, 0))
    const next = nextRunFromFrequency("monthly", mar31)
    expect(next.toISOString()).toBe("2026-04-30T12:00:00.000Z")
  })

  it("monthly from Oct 31 clamps to Nov 30", () => {
    const oct31 = new Date(Date.UTC(2026, 9, 31, 12, 0, 0))
    const next = nextRunFromFrequency("monthly", oct31)
    expect(next.toISOString()).toBe("2026-11-30T12:00:00.000Z")
  })

  it("monthly from Feb 28 in non-leap year stays Feb 28 next year", () => {
    const feb28 = new Date(Date.UTC(2026, 1, 28, 12, 0, 0))
    const next = nextRunFromFrequency("annually", feb28)
    // 2027 is not a leap year; Feb 28 + 12 months = Feb 28 2027.
    expect(next.toISOString()).toBe("2027-02-28T12:00:00.000Z")
  })

  it("every_2mo from Jan 31 → Mar 31 (no clamping needed)", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    const next = nextRunFromFrequency("every_2mo", jan31)
    expect(next.toISOString()).toBe("2026-03-31T12:00:00.000Z")
  })

  it("every_3mo from Jan 31 clamps to Apr 30 (not May 1)", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    const next = nextRunFromFrequency("every_3mo", jan31)
    expect(next.toISOString()).toBe("2026-04-30T12:00:00.000Z")
  })
})
