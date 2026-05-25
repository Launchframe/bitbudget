export interface SuggestedImportIncomeInput {
  priorImports: readonly { amount: number }[]
  monthlyIncome: number
  latestSavingsGoal: number | null
  sumAllotments: number
}

/** First defined: latest prior import → monthlyIncome → goal+allotments → allotments → 0. */
export function suggestedImportIncome(input: SuggestedImportIncomeInput): number {
  const latestPrior = input.priorImports.find((p) => Number.isFinite(p.amount) && p.amount > 0)
  if (latestPrior) return latestPrior.amount

  if (Number.isFinite(input.monthlyIncome) && input.monthlyIncome > 0) {
    return input.monthlyIncome
  }

  const goal = input.latestSavingsGoal ?? 0
  if (goal > 0 && input.sumAllotments > 0) return goal + input.sumAllotments
  if (goal > 0) return goal
  if (input.sumAllotments > 0) return input.sumAllotments

  return 0
}

/** 1% of suggested income, rounded to nearest $10 (min $10). */
export function incomeRelativeFineStep(suggested: number): number {
  if (!Number.isFinite(suggested) || suggested <= 0) return 10
  return Math.max(10, Math.round((suggested * 0.01) / 10) * 10)
}
