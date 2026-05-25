/** Progress bar fill color from % of monthly allotment remaining (matches sweep dialog thresholds). */
export function envelopeHealthColor(percentage: number): string {
  return percentage > 25 ? "#22C55E" : percentage > 10 ? "#EAB308" : "#EF4444"
}

/** % of monthly allotment still in the envelope (uncapped; may exceed 100 with carryover). */
export function envelopeBudgetProgressPct(balance: number, monthlyAllotment: number): number {
  if (!Number.isFinite(monthlyAllotment) || monthlyAllotment <= 0) return 0
  if (!Number.isFinite(balance) || balance <= 0) return 0
  return (balance / monthlyAllotment) * 100
}
