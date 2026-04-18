import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  getReferralPlaidSnoozeUntilMs,
  isReferralPlaidReminderSnoozed,
  referralPlaidReminderSnoozeKey,
  snoozeReferralPlaidReminder,
} from "@/lib/referral-plaid-reminder"

describe("referralPlaidReminderSnoozeKey", () => {
  it("scopes by user id", () => {
    expect(referralPlaidReminderSnoozeKey("u1")).toContain("u1")
    expect(referralPlaidReminderSnoozeKey("u1")).not.toBe(referralPlaidReminderSnoozeKey("u2"))
  })
})

describe("referral plaid snooze storage", () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    const ls = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    } as Storage
    vi.stubGlobal("localStorage", ls)
    vi.stubGlobal("window", { localStorage: ls } as Window & typeof globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("snooze then is snoozed until expiry", () => {
    const now = 1_000_000
    const uid = "user-c"
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now)
    expect(isReferralPlaidReminderSnoozed(uid, now)).toBe(false)
    snoozeReferralPlaidReminder(uid, 1)
    const until = getReferralPlaidSnoozeUntilMs(uid)
    dateSpy.mockRestore()
    expect(until).toBeGreaterThan(now)
    expect(isReferralPlaidReminderSnoozed(uid, now)).toBe(true)
    expect(isReferralPlaidReminderSnoozed(uid, until! + 1)).toBe(false)
  })
})
