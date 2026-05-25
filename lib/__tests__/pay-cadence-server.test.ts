// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  assertPayCadencePersistable,
  isDailyCadenceBlocked,
  isDailyPayCadenceAllowed,
  isFundingDayForUser,
} from "../pay-cadence-server"
import type { PaydayUserFields } from "../payday-cadence"

describe("pay-cadence-server", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("allows daily cadence outside production", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(isDailyPayCadenceAllowed()).toBe(true)
    expect(() => assertPayCadencePersistable("daily")).not.toThrow()
  })

  it("blocks daily cadence in production unless flagged", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("INTERNAL_PAY_CADENCES", "")
    expect(isDailyPayCadenceAllowed()).toBe(false)
    expect(() => assertPayCadencePersistable("daily")).toThrow("PAY_CADENCE_DAILY_DISABLED")
  })

  it("allows daily cadence in production when INTERNAL_PAY_CADENCES=true", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("INTERNAL_PAY_CADENCES", "true")
    expect(isDailyPayCadenceAllowed()).toBe(true)
    expect(() => assertPayCadencePersistable("daily")).not.toThrow()
  })

  it("allows non-daily cadences regardless", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("INTERNAL_PAY_CADENCES", "")
    expect(() => assertPayCadencePersistable("monthly")).not.toThrow()
  })

  it("isDailyCadenceBlocked is true only for daily when disallowed", () => {
    expect(isDailyCadenceBlocked("daily", false)).toBe(true)
    expect(isDailyCadenceBlocked("daily", true)).toBe(false)
    expect(isDailyCadenceBlocked("weekly", false)).toBe(false)
  })

  it("isFundingDayForUser is false on non-paydays for monthly users with empty payDays", () => {
    const user: PaydayUserFields = {
      payCadence: "monthly",
      payDays: [],
      payDayOfWeek: null,
      lastPaydayAt: null,
    }
    expect(isFundingDayForUser(user, new Date(Date.UTC(2026, 4, 1)))).toBe(true)
    expect(isFundingDayForUser(user, new Date(Date.UTC(2026, 4, 2)))).toBe(false)
  })

  it("isFundingDayForUser is false on non-paydays for bimonthly users with empty payDays", () => {
    const user: PaydayUserFields = {
      payCadence: "bimonthly",
      payDays: [],
      payDayOfWeek: null,
      lastPaydayAt: null,
    }
    expect(isFundingDayForUser(user, new Date(Date.UTC(2026, 4, 1)))).toBe(true)
    expect(isFundingDayForUser(user, new Date(Date.UTC(2026, 4, 15)))).toBe(false)
    expect(isFundingDayForUser(user, new Date(Date.UTC(2026, 4, 16)))).toBe(true)
    expect(isFundingDayForUser(user, new Date(Date.UTC(2026, 4, 17)))).toBe(false)
  })
})
