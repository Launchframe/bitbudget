/** Map `/api/referral/redeem` error payloads to plain-language copy. */

export type ReferralRedeemErrorPayload = {
  error?: string
  code?: string
}

export function referralRedeemErrorMessage(payload: ReferralRedeemErrorPayload): string {
  const code = payload.code
  if (code === "already_redeemed") {
    return "This account already used a referral code."
  }
  if (code === "redeem_window_closed") {
    return "Referral codes can only be applied within 7 days of finishing onboarding."
  }
  if (code === "self_referral") {
    return "You cannot use your own referral code."
  }
  if (
    code === "expired" ||
    code === "exhausted" ||
    code === "not_found" ||
    payload.error === "Referral code is not valid"
  ) {
    return "That code looks invalid, expired, or already used up. Double-check the code and try again."
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error
  }
  return "We couldn't apply that referral code. Please try again."
}

export const REFERRAL_REDEEM_SUCCESS_MESSAGE =
  "Referral code applied! Connect your bank to start your premium trial."

/**
 * Used in Settings and cross-page flash (Dashboard) where bank linking context is absent.
 * The Plaid-specific reminder already appears via `refereePendingBankLink` UI when applicable.
 */
export const REFERRAL_REDEEM_SUCCESS_MESSAGE_SHORT =
  "Referral code applied! Your account has been updated."

export const REFERRAL_VALIDATE_SUCCESS_HINT =
  "Code accepted — we'll apply it when you finish setup."

export const REFERRAL_REDEEM_FLASH_KEY = "bitbudget-referral-redeem-flash"

export type ReferralRedeemFlash = {
  type: "success" | "error"
  message: string
}

export function setReferralRedeemFlash(flash: ReferralRedeemFlash): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(REFERRAL_REDEEM_FLASH_KEY, JSON.stringify(flash))
  } catch {
    /* ignore */
  }
}

export function consumeReferralRedeemFlash(): ReferralRedeemFlash | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(REFERRAL_REDEEM_FLASH_KEY)
    sessionStorage.removeItem(REFERRAL_REDEEM_FLASH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ReferralRedeemFlash
    if (parsed?.type !== "success" && parsed?.type !== "error") return null
    if (typeof parsed.message !== "string" || !parsed.message.trim()) return null
    return parsed
  } catch {
    return null
  }
}
