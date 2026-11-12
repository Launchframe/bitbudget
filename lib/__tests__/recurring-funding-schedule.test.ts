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

  it("monthly from Jan 31 wraps via UTC month overflow", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    const next = nextRunFromFrequency("monthly", jan31)
    expect(next.getUTCMonth()).toBe(2)
  })
})
