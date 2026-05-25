// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  fundingCronUserWhere,
  isGoalMaintenanceDay,
  shouldRunFundingCronForUser,
} from "../funding-cron-schedule"
import type { PaydayUserFields } from "../payday-cadence"

function user(overrides: Partial<PaydayUserFields> = {}): PaydayUserFields {
  return {
    payCadence: "monthly",
    payDays: [],
    payDayOfWeek: null,
    lastPaydayAt: null,
    ...overrides,
  }
}

describe("funding-cron-schedule", () => {
  it("isGoalMaintenanceDay is true only on UTC 1st", () => {
    expect(isGoalMaintenanceDay(new Date(Date.UTC(2026, 4, 1)))).toBe(true)
    expect(isGoalMaintenanceDay(new Date(Date.UTC(2026, 4, 2)))).toBe(false)
  })

  it("shouldRunFundingCronForUser includes irregular users on goal day only", () => {
    const irregular = user({ payCadence: "irregular" })
    expect(shouldRunFundingCronForUser(irregular, new Date(Date.UTC(2026, 4, 1)))).toBe(true)
    expect(shouldRunFundingCronForUser(irregular, new Date(Date.UTC(2026, 4, 2)))).toBe(false)
  })

  it("shouldRunFundingCronForUser includes monthly users on paydays", () => {
    expect(shouldRunFundingCronForUser(user(), new Date(Date.UTC(2026, 4, 1)))).toBe(true)
    expect(shouldRunFundingCronForUser(user(), new Date(Date.UTC(2026, 4, 2)))).toBe(false)
  })

  it("fundingCronUserWhere excludes irregular/mixed on non-goal days", () => {
    const where = fundingCronUserWhere(new Date(Date.UTC(2026, 4, 15)))
    expect(where).toMatchObject({
      payCadence: { notIn: ["irregular", "mixed"] },
    })
  })

  it("fundingCronUserWhere loads all keyed users on goal day", () => {
    const where = fundingCronUserWhere(new Date(Date.UTC(2026, 5, 1)))
    expect(where.payCadence).toBeUndefined()
  })
})
