import { describe, expect, it, vi } from "vitest"
import {
  consumeReferralRedeemFlash,
  referralRedeemErrorMessage,
  REFERRAL_REDEEM_FLASH_KEY,
  setReferralRedeemFlash,
} from "../referral-redeem-messages"

describe("referralRedeemErrorMessage", () => {
  it("maps known error codes", () => {
    expect(referralRedeemErrorMessage({ code: "already_redeemed" })).toMatch(/already used/i)
    expect(referralRedeemErrorMessage({ code: "redeem_window_closed" })).toMatch(/7 days/i)
    expect(referralRedeemErrorMessage({ code: "self_referral" })).toMatch(/your own/i)
    expect(referralRedeemErrorMessage({ code: "expired" })).toMatch(/invalid, expired/i)
    expect(referralRedeemErrorMessage({ code: "exhausted" })).toMatch(/invalid, expired/i)
    expect(referralRedeemErrorMessage({ code: "not_found" })).toMatch(/invalid, expired/i)
  })

  it("falls back to server error text", () => {
    expect(referralRedeemErrorMessage({ error: "Custom server message" })).toBe("Custom server message")
  })

  it("returns generic fallback for empty payload", () => {
    expect(referralRedeemErrorMessage({})).toMatch(/couldn't apply/i)
  })
})

describe("referral redeem flash sessionStorage", () => {
  it("round-trips and consumes once", () => {
    const store = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    })

    setReferralRedeemFlash({ type: "success", message: "Applied!" })
    expect(store.has(REFERRAL_REDEEM_FLASH_KEY)).toBe(true)
    expect(consumeReferralRedeemFlash()).toEqual({ type: "success", message: "Applied!" })
    expect(consumeReferralRedeemFlash()).toBeNull()
  })
})
