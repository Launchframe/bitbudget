// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  SAVINGS_GOAL_DEFAULT_PERIOD,
  SAVINGS_GOAL_GRACE_DAYS,
  graceEndsAtForPeriod,
  isValidCalendarMonthPeriodKey,
  savingsGoalEditability,
} from "../savings-goal"

describe("isValidCalendarMonthPeriodKey", () => {
  it("accepts valid months and rejects invalid month numbers", () => {
    expect(isValidCalendarMonthPeriodKey("2026-05")).toBe(true)
    expect(isValidCalendarMonthPeriodKey("2026-13")).toBe(false)
    expect(isValidCalendarMonthPeriodKey("2026-00")).toBe(false)
    expect(isValidCalendarMonthPeriodKey("2026")).toBe(false)
  })
})

describe("savingsGoalEditability", () => {
  it("default period is always editable", () => {
    expect(
      savingsGoalEditability({
        periodKey: SAVINGS_GOAL_DEFAULT_PERIOD,
        graceEndsAt: null,
        closedAt: null,
      }),
    ).toBe("editable")
  })

  it("closed period is closed", () => {
    expect(
      savingsGoalEditability({
        periodKey: "2026-05",
        graceEndsAt: new Date("2026-05-08T00:00:00.000Z"),
        closedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).toBe("closed")
  })

  it("after grace expires, only upward edits allowed", () => {
    const graceEndsAt = new Date("2026-05-08T00:00:00.000Z")
    expect(
      savingsGoalEditability(
        { periodKey: "2026-05", graceEndsAt, closedAt: null },
        new Date("2026-05-08T00:00:00.000Z"),
      ),
    ).toBe("upward_only")
    expect(
      savingsGoalEditability(
        { periodKey: "2026-05", graceEndsAt, closedAt: null },
        new Date("2026-05-07T23:59:59.999Z"),
      ),
    ).toBe("editable")
  })
})

describe("graceEndsAtForPeriod", () => {
  it("returns null for default period", () => {
    expect(
      graceEndsAtForPeriod({
        periodKey: SAVINGS_GOAL_DEFAULT_PERIOD,
        userCreatedAt: new Date("2026-05-20T00:00:00.000Z"),
      }),
    ).toBeNull()
  })

  it("uses later of period start and signup for grace base", () => {
    const grace = graceEndsAtForPeriod({
      periodKey: "2026-05",
      userCreatedAt: new Date("2026-05-20T00:00:00.000Z"),
    })
    expect(grace).not.toBeNull()
    const expected = new Date("2026-05-20T00:00:00.000Z")
    expected.setUTCDate(expected.getUTCDate() + SAVINGS_GOAL_GRACE_DAYS)
    expect(grace!.toISOString()).toBe(expected.toISOString())
  })

  it("uses period start when signup is earlier", () => {
    const grace = graceEndsAtForPeriod({
      periodKey: "2026-05",
      userCreatedAt: new Date("2026-04-01T00:00:00.000Z"),
    })
    expect(grace).not.toBeNull()
    const expected = new Date(Date.UTC(2026, 4, 1, 0, 0, 0, 0))
    expected.setUTCDate(expected.getUTCDate() + SAVINGS_GOAL_GRACE_DAYS)
    expect(grace!.toISOString()).toBe(expected.toISOString())
  })

  it("returns null for invalid month keys", () => {
    expect(
      graceEndsAtForPeriod({
        periodKey: "2026-13",
        userCreatedAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
    ).toBeNull()
  })
})
