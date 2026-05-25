import { describe, expect, it } from "vitest"
import { incomeRelativeFineStep, suggestedImportIncome } from "../income-import-defaults"

describe("income-import-defaults", () => {
  it("suggestedImportIncome prefers prior import then monthly income", () => {
    expect(
      suggestedImportIncome({
        priorImports: [{ amount: 3200 }],
        monthlyIncome: 5000,
        latestSavingsGoal: 500,
        sumAllotments: 4000,
      }),
    ).toBe(3200)

    expect(
      suggestedImportIncome({
        priorImports: [],
        monthlyIncome: 5000,
        latestSavingsGoal: 500,
        sumAllotments: 4000,
      }),
    ).toBe(5000)

    expect(
      suggestedImportIncome({
        priorImports: [],
        monthlyIncome: 0,
        latestSavingsGoal: 500,
        sumAllotments: 4000,
      }),
    ).toBe(4500)
  })

  it("incomeRelativeFineStep is 1% rounded to $10 min $10", () => {
    expect(incomeRelativeFineStep(5000)).toBe(50)
    expect(incomeRelativeFineStep(100)).toBe(10)
    expect(incomeRelativeFineStep(0)).toBe(10)
  })
})
