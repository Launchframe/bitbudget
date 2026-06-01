/**
 * Client-side gates before server-backed transaction capture (irregular income, etc.).
 * Plain-language messages only — no encryption jargon.
 */

export type TransactionCaptureBlocker =
  | "secure_data"
  | "unlock_required"
  | "monthly_income"

export type TransactionCaptureReadiness =
  | { ok: true }
  | { ok: false; blocker: TransactionCaptureBlocker; message: string }

export function assessTransactionCaptureReadiness(params: {
  encryptionReady: boolean
  needsPinUnlock: boolean
  hasEncryptedPrivacyKeyOnServer: boolean
  monthlyIncome: number
}): TransactionCaptureReadiness {
  if (params.needsPinUnlock) {
    return {
      ok: false,
      blocker: "unlock_required",
      message: "Unlock your budget data before recording income or transactions.",
    }
  }
  if (!params.encryptionReady) {
    return {
      ok: false,
      blocker: "secure_data",
      message: "Finish Secure Your Data setup before recording income or transactions.",
    }
  }
  if (!params.hasEncryptedPrivacyKeyOnServer) {
    return {
      ok: false,
      blocker: "secure_data",
      message: "Finish Secure Your Data setup before recording income or transactions.",
    }
  }
  if (!Number.isFinite(params.monthlyIncome) || params.monthlyIncome <= 0) {
    return {
      ok: false,
      blocker: "monthly_income",
      message: "Set a positive monthly income under Settings → Allocations before recording extra income.",
    }
  }
  return { ok: true }
}
