/**
 * Shared constants used across client components and server-side routes.
 * Keep this file free of client-only or server-only imports.
 */

export const PRESET_ENVELOPE_COLORS = [
  "#F7931A", "#3B82F6", "#10B981", "#8B5CF6",
  "#EF4444", "#EAB308", "#EC4899", "#06B6D4",
  "#F97316", "#84CC16", "#14B8A6",
]

/** Reserved display name for the system-managed Savings envelope (ledger funding). */
export const RESERVED_SAVINGS_ENVELOPE_NAME = "Savings"

/** Prisma `Envelope.systemRole` value for the Savings envelope. */
export const SYSTEM_ENVELOPE_ROLE_SAVINGS = "savings"

/** Visible Income rows use this plaintext label server-side before asymmetric encrypt. */
export const LEDGER_INCOME_PAYEE_LABEL = "Income"

/** Funding allocation legs use this plaintext label (hidden from main history). */
export const LEDGER_ALLOCATION_PAYEE_LABEL = "Envelope allocation"

export const SWEEP_POLICY_RESET = "reset"
export const SWEEP_POLICY_CARRY_FORWARD = "carry_forward"
export const SWEEP_POLICY_CAPPED = "capped"

export const SAVINGS_EXPERIENCE_ENGAGED = "engaged"
export const SAVINGS_EXPERIENCE_DISMISSED = "dismissed"

/** Rolling fallback row in SavingsGoal when no per-month override exists. */
export const SAVINGS_GOAL_DEFAULT_PERIOD = "default"

/** Savings UI accent (distinct from Bitcoin orange #F7931A). */
export const SAVINGS_GOLD_ACCENT = "#D4AF37"

export const TX_SOURCE_INCOME_IMPORT = "income_import"
export const TX_SOURCE_ENVELOPE_SWEEP = "envelope_sweep"

export const ENVELOPE_FUNDING_BATCH_KIND_FUND = "fund"
export const ENVELOPE_FUNDING_BATCH_KIND_SWEEP = "sweep"

export function isReservedSavingsEnvelopeName(name: string): boolean {
  return name.trim().toLowerCase() === RESERVED_SAVINGS_ENVELOPE_NAME.toLowerCase()
}

/** Budget envelopes receive allotment slices; system Savings holds unallocated income. */
export function isBudgetEnvelope(systemRole: string | null | undefined): boolean {
  return systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS
}
