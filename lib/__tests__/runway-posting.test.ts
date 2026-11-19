import { describe, expect, it } from "vitest"
import {
  TX_SOURCE_BTC_SALE_CONVERSION,
  TX_SOURCE_LOAN_LIQUIDATION,
  TX_SOURCE_LOAN_OPEN,
  TX_SOURCE_LOAN_PAYOFF,
  TX_SOURCE_LOAN_ROLL,
} from "../constants"
import {
  RUNWAY_BTC_CONVERSION_SOURCES,
  RUNWAY_LOAN_STACK_SOURCES,
  RUNWAY_STACK_MOVE_SOURCES,
  classifyRunwayPosting,
  countsAsRunwayIncome,
  countsAsSavingsGoalCredit,
  countsAsUserFacingExpense,
  isBtcSaleConversion,
  isLoanStackMove,
  isRunwayStackMove,
} from "../runway-posting"
import { isUserFacingExpense } from "../transaction-visibility"
import { MONTHLY_INCOME_SOURCES, SAVINGS_INFLOW_SOURCES } from "../savings-ui-metrics"
import { CASH_INFLOW_SOURCES } from "../cash-flow-series"

const LOAN_SOURCES = [
  TX_SOURCE_LOAN_OPEN,
  TX_SOURCE_LOAN_ROLL,
  TX_SOURCE_LOAN_PAYOFF,
  TX_SOURCE_LOAN_LIQUIDATION,
]
const ALL_STACK_SOURCES = [TX_SOURCE_BTC_SALE_CONVERSION, ...LOAN_SOURCES]

describe("runway-posting source sets", () => {
  it("separates conversion and loan sources", () => {
    expect([...RUNWAY_BTC_CONVERSION_SOURCES]).toEqual([TX_SOURCE_BTC_SALE_CONVERSION])
    expect([...RUNWAY_LOAN_STACK_SOURCES].sort()).toEqual([...LOAN_SOURCES].sort())
  })

  it("unions both into the full stack-move set", () => {
    expect([...RUNWAY_STACK_MOVE_SOURCES].sort()).toEqual([...ALL_STACK_SOURCES].sort())
  })
})

describe("isBtcSaleConversion / isLoanStackMove / isRunwayStackMove", () => {
  it("recognizes a bitcoin sale conversion", () => {
    const txn = { source: TX_SOURCE_BTC_SALE_CONVERSION }
    expect(isBtcSaleConversion(txn)).toBe(true)
    expect(isLoanStackMove(txn)).toBe(false)
    expect(isRunwayStackMove(txn)).toBe(true)
  })

  it("recognizes every loan stack move", () => {
    for (const source of LOAN_SOURCES) {
      const txn = { source }
      expect(isLoanStackMove(txn)).toBe(true)
      expect(isBtcSaleConversion(txn)).toBe(false)
      expect(isRunwayStackMove(txn)).toBe(true)
    }
  })

  it("ignores ordinary sources (manual, paycheck, income import)", () => {
    for (const source of [undefined, "manual", "paycheck", "income_import", "plaid"]) {
      const txn = { source } as { source?: string }
      expect(isRunwayStackMove(txn)).toBe(false)
      expect(isBtcSaleConversion(txn)).toBe(false)
      expect(isLoanStackMove(txn)).toBe(false)
    }
  })

  it("treats a missing source as manual (not a stack move)", () => {
    expect(isRunwayStackMove({})).toBe(false)
  })
})

describe("classifyRunwayPosting", () => {
  it("classifies conversions, loan moves, and other", () => {
    expect(classifyRunwayPosting({ source: TX_SOURCE_BTC_SALE_CONVERSION })).toBe(
      "btc_sale_conversion",
    )
    expect(classifyRunwayPosting({ source: TX_SOURCE_LOAN_OPEN })).toBe("loan_stack_move")
    expect(classifyRunwayPosting({ source: TX_SOURCE_LOAN_LIQUIDATION })).toBe(
      "loan_stack_move",
    )
    expect(classifyRunwayPosting({ source: "manual" })).toBe("other")
    expect(classifyRunwayPosting({})).toBe("other")
  })
})

describe("posting-contract predicates", () => {
  it("no stack move counts as income, savings-goal credit, or spending", () => {
    for (const source of ALL_STACK_SOURCES) {
      const txn = { source }
      expect(countsAsRunwayIncome(txn)).toBe(false)
      expect(countsAsSavingsGoalCredit(txn)).toBe(false)
      expect(countsAsUserFacingExpense(txn)).toBe(false)
    }
  })

  it("ordinary rows still count", () => {
    const txn = { source: "manual" }
    expect(countsAsRunwayIncome(txn)).toBe(true)
    expect(countsAsSavingsGoalCredit(txn)).toBe(true)
    expect(countsAsUserFacingExpense(txn)).toBe(true)
  })
})

describe("visibility wiring", () => {
  it("isUserFacingExpense excludes runway stack moves posted as expenses", () => {
    for (const source of ALL_STACK_SOURCES) {
      expect(
        isUserFacingExpense({
          type: "expense",
          excludeFromMainHistory: false,
          source: source as never,
        }),
      ).toBe(false)
    }
  })

  it("isUserFacingExpense still counts a plain manual expense", () => {
    expect(
      isUserFacingExpense({ type: "expense", excludeFromMainHistory: false, source: "manual" }),
    ).toBe(true)
  })
})

describe("allowlist contract: runway sources stay out of income/savings/cash inflows", () => {
  it("are absent from the monthly-income allowlist", () => {
    for (const source of ALL_STACK_SOURCES) {
      expect(MONTHLY_INCOME_SOURCES.has(source)).toBe(false)
    }
  })

  it("are absent from the savings-inflow allowlist", () => {
    for (const source of ALL_STACK_SOURCES) {
      expect(SAVINGS_INFLOW_SOURCES.has(source)).toBe(false)
    }
  })

  it("are absent from the cash-inflow allowlist", () => {
    for (const source of ALL_STACK_SOURCES) {
      expect(CASH_INFLOW_SOURCES.has(source)).toBe(false)
    }
  })
})
