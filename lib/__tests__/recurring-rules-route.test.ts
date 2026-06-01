// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({ prisma: { recurringFundingRule: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() } } }))

import { nextRunFromFrequency } from "@/app/api/recurring-rules/route"

describe("nextRunFromFrequency", () => {
  const base = new Date(Date.UTC(2026, 0, 14, 12, 0, 0)) // 2026-01-14

  it("weekly adds 7 days", () => {
    const next = nextRunFromFrequency("weekly", base)
    expect(next.toISOString()).toBe("2026-01-21T12:00:00.000Z")
  })

  it("bimonthly adds 14 days", () => {
    const next = nextRunFromFrequency("bimonthly", base)
    expect(next.toISOString()).toBe("2026-01-28T12:00:00.000Z")
  })

  it("monthly adds 1 calendar month", () => {
    const next = nextRunFromFrequency("monthly", base)
    expect(next.toISOString()).toBe("2026-02-14T12:00:00.000Z")
  })

  it("every_2mo adds 2 months", () => {
    const next = nextRunFromFrequency("every_2mo", base)
    expect(next.toISOString()).toBe("2026-03-14T12:00:00.000Z")
  })

  it("every_3mo adds 3 months", () => {
    const next = nextRunFromFrequency("every_3mo", base)
    expect(next.toISOString()).toBe("2026-04-14T12:00:00.000Z")
  })

  it("every_6mo adds 6 months", () => {
    const next = nextRunFromFrequency("every_6mo", base)
    expect(next.toISOString()).toBe("2026-07-14T12:00:00.000Z")
  })

  it("annually adds 12 months", () => {
    const next = nextRunFromFrequency("annually", base)
    expect(next.toISOString()).toBe("2027-01-14T12:00:00.000Z")
  })

  it("unknown frequency defaults to monthly", () => {
    const next = nextRunFromFrequency("unknown", base)
    expect(next.toISOString()).toBe("2026-02-14T12:00:00.000Z")
  })

  it("monthly from Jan 31 wraps to Mar 3 (UTC month-end overflow)", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    // Date.UTC(2026, 1, 31) → Feb 31 → Mar 3 (JS overflow)
    const next = nextRunFromFrequency("monthly", jan31)
    // JS Date overflows to March 3
    expect(next.getUTCMonth()).toBe(2) // March
  })
})
