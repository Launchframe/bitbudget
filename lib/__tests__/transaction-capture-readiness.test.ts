// @vitest-environment node
import { describe, expect, it } from "vitest"
import { assessTransactionCaptureReadiness } from "../transaction-capture-readiness"

describe("transaction-capture-readiness", () => {
  it("blocks when PIN unlock required", () => {
    const r = assessTransactionCaptureReadiness({
      encryptionReady: false,
      needsPinUnlock: true,
      hasEncryptedPrivacyKeyOnServer: true,
      monthlyIncome: 5000,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blocker).toBe("unlock_required")
  })

  it("blocks when monthly income unset", () => {
    const r = assessTransactionCaptureReadiness({
      encryptionReady: true,
      needsPinUnlock: false,
      hasEncryptedPrivacyKeyOnServer: true,
      monthlyIncome: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blocker).toBe("monthly_income")
  })

  it("allows when ready", () => {
    expect(
      assessTransactionCaptureReadiness({
        encryptionReady: true,
        needsPinUnlock: false,
        hasEncryptedPrivacyKeyOnServer: true,
        monthlyIncome: 4000,
      }).ok,
    ).toBe(true)
  })
})
