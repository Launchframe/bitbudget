export interface SuggestedImportIncomeInput {
  priorImports: readonly { amount: number; periodKey: string }[]
  monthlyIncome: number
  latestSavingsGoal: number | null
  sumAllotments: number
}

function latestPriorImportAmount(
  priorImports: SuggestedImportIncomeInput["priorImports"],
): number | null {
  let bestAmount: number | null = null
  let bestPeriodKey = ""
  for (const row of priorImports) {
    if (!Number.isFinite(row.amount) || row.amount <= 0) continue
    if (bestAmount == null || row.periodKey > bestPeriodKey) {
      bestAmount = row.amount
      bestPeriodKey = row.periodKey
    }
  }
  return bestAmount
}

/** First defined: latest prior import → monthlyIncome → goal+allotments → allotments → 0. */
export function suggestedImportIncome(input: SuggestedImportIncomeInput): number {
  const latestPrior = latestPriorImportAmount(input.priorImports)
  if (latestPrior != null) return latestPrior

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
