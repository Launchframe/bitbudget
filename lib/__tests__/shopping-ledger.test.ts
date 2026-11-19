// @vitest-environment node
import { describe, expect, it } from "vitest"
import { amountOwed, canRecordRepayment, prepaidCredit, reduceShoppingTab, type ShoppingLedgerEvent } from "../shopping-ledger"
import { expectedShoppingEntryType, projectMemberBudget } from "../shopping-budget-projection"
import { parseShoppingEventPayload } from "../shopping-event-validation"
import { isShoppingCashInflow, isShoppingCashOutflow, isShoppingPersonalSpend } from "../shopping-classification"
import { isUserFacingExpense } from "../transaction-visibility"
import { isCashInflowCredit, isCashOutflowExpense } from "../cash-flow-series"

const A = "memberA"
const B = "memberB"

function receiptEvent(id: string, sequence: number, shares: Array<{ memberId: string; cents: number }>): ShoppingLedgerEvent {
  const totalCents = shares.reduce((s, sh) => s + sh.cents, 0)
  return {
    id,
    sequence,
    actorMemberId: A,
    payload: {
      schemaVersion: 1,
      type: "receipt_finalized",
      receiptId: `rcpt-${id}`,
      payerMemberId: A,
      postedOn: "2026-09-01",
      currency: "USD",
      totalCents,
      shares,
    },
  }
}

function payEvent(id: string, sequence: number, cents: number): ShoppingLedgerEvent {
  return {
    id,
    sequence,
    actorMemberId: B,
    payload: {
      schemaVersion: 1,
      type: "repayment",
      fromMemberId: B,
      toMemberId: A,
      cents,
      postedOn: "2026-09-02",
    },
  }
}

describe("shopping tab fixture $100 / $40 / $60", () => {
  it("tracks pairwise debt until repayment", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
    ]
    const tab = reduceShoppingTab(events)
    expect(amountOwed(tab, B, A)).toBe(6000)
    expect(amountOwed(tab, A, B)).toBe(0)
  })

  it("applies partial then remaining payments", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 2000),
      payEvent("e3", 3, 4000),
    ]
    const tab = reduceShoppingTab(events)
    expect(amountOwed(tab, B, A)).toBe(0)
    expect(prepaidCredit(tab, B, A)).toBe(0)
  })

  it("keeps $10 overpayment as prepaid credit", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 7000),
    ]
    const tab = reduceShoppingTab(events)
    expect(amountOwed(tab, B, A)).toBe(0)
    expect(prepaidCredit(tab, B, A)).toBe(1000)
  })

  it("consumes prepaid on a later $10 purchase for B", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 7000),
      receiptEvent("e3", 3, [
        { memberId: A, cents: 0 },
        { memberId: B, cents: 1000 },
      ]),
    ]
    const tab = reduceShoppingTab(events)
    expect(amountOwed(tab, B, A)).toBe(0)
    expect(prepaidCredit(tab, B, A)).toBe(0)
  })
})

describe("shopping projections", () => {
  const pref = {
    enabled: true,
    enabledAtSequence: 1,
    catchUpApproved: false,
    envelopeId: "env",
    preferenceVersion: 1,
  }

  it("posts payer grocery + advance, then recoveries on repayment", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 2000),
      payEvent("e3", 3, 4000),
    ]
    const aRows = projectMemberBudget({
      events,
      context: { memberId: A, preference: pref, missingAdvanceEventIds: new Set() },
    })
    const bRows = projectMemberBudget({
      events,
      context: { memberId: B, preference: pref, missingAdvanceEventIds: new Set() },
    })
    expect(aRows.filter((r) => r.kind === "own_expense").map((r) => r.cents)).toEqual([4000])
    expect(aRows.filter((r) => r.kind === "advance_out").map((r) => r.cents)).toEqual([6000])
    expect(aRows.filter((r) => r.kind === "advance_recovery").map((r) => r.cents)).toEqual([2000, 4000])
    expect(bRows.filter((r) => r.kind === "own_expense")).toHaveLength(0)
    expect(bRows.filter((r) => r.kind === "repayment_expense").map((r) => r.cents)).toEqual([2000, 4000])
  })

  it("splits a $70 overpayment into $60 expense + $10 prepaid", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 7000),
    ]
    const bRows = projectMemberBudget({
      events,
      context: { memberId: B, preference: pref, missingAdvanceEventIds: new Set() },
    })
    const aRows = projectMemberBudget({
      events,
      context: { memberId: A, preference: pref, missingAdvanceEventIds: new Set() },
    })
    expect(bRows.find((r) => r.kind === "repayment_expense")?.cents).toBe(6000)
    expect(bRows.find((r) => r.kind === "prepaid_out")?.cents).toBe(1000)
    expect(aRows.find((r) => r.kind === "advance_recovery")?.cents).toBe(6000)
    expect(aRows.find((r) => r.kind === "prepaid_in")?.cents).toBe(1000)
  })

  it("keeps a stable payback key and blocks the credit when that cover was skipped", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 2000),
    ]
    const rows = projectMemberBudget({
      events,
      context: { memberId: A, preference: pref, missingAdvanceEventIds: new Set(["e1"]) },
    })
    const recovery = rows.find((row) => row.kind === "advance_recovery")
    expect(recovery?.entryKey).toBe("e2:advance_recovery")
    expect(recovery?.needsAttention).toBe(true)
  })

  it("still offers a payback when a different person's cover was skipped", () => {
    const events = [
      receiptEvent("e1", 1, [
        { memberId: A, cents: 4000 },
        { memberId: B, cents: 6000 },
      ]),
      payEvent("e2", 2, 2000),
    ]
    const rows = projectMemberBudget({
      events,
      context: { memberId: A, preference: pref, missingAdvanceEventIds: new Set(["other-receipt"]) },
    })
    const recovery = rows.find((row) => row.kind === "advance_recovery")
    expect(recovery?.entryKey).toBe("e2:advance_recovery")
    expect(recovery?.needsAttention).toBeUndefined()
  })
})

describe("shopping event validation", () => {
  it("rejects a third party recording someone else's payment", () => {
    expect(
      canRecordRepayment({ actorMemberId: "C", fromMemberId: A, toMemberId: B }),
    ).toBe(false)
    expect(() =>
      parseShoppingEventPayload({
        schemaVersion: 1,
        type: "repayment",
        fromMemberId: A,
        toMemberId: A,
        cents: 100,
        postedOn: "2026-09-01",
      }),
    ).toThrow()
  })
})

describe("shopping classification", () => {
  it("counts repayment as personal spend and cash out, advance as cash only", () => {
    const advance = { type: "expense" as const, source: "shopping_advance_out" as const, excludeFromMainHistory: false }
    const own = { type: "expense" as const, source: "shopping_own_expense" as const, excludeFromMainHistory: false }
    const recovery = { type: "credit" as const, source: "shopping_advance_recovery" as const, excludeFromMainHistory: false }
    const apply = { type: "expense" as const, source: "shopping_prepaid_apply" as const, excludeFromMainHistory: false }
    expect(isShoppingPersonalSpend(own)).toBe(true)
    expect(isUserFacingExpense(own)).toBe(true)
    expect(isUserFacingExpense(advance)).toBe(false)
    expect(isShoppingCashOutflow(advance)).toBe(true)
    expect(isCashOutflowExpense(advance)).toBe(true)
    expect(isCashOutflowExpense(apply)).toBe(false)
    expect(isUserFacingExpense(apply)).toBe(true)
    expect(isShoppingCashInflow(recovery)).toBe(true)
    expect(isCashInflowCredit(recovery)).toBe(true)
  })

  it("ties each shopping entry kind to one amount direction", () => {
    expect(expectedShoppingEntryType("own_expense")).toBe("expense")
    expect(expectedShoppingEntryType("advance_out")).toBe("expense")
    expect(expectedShoppingEntryType("repayment_expense")).toBe("expense")
    expect(expectedShoppingEntryType("prepaid_out")).toBe("expense")
    expect(expectedShoppingEntryType("prepaid_apply")).toBe("expense")
    expect(expectedShoppingEntryType("advance_recovery")).toBe("credit")
    expect(expectedShoppingEntryType("prepaid_in")).toBe("credit")
    expect(expectedShoppingEntryType("correction")).toBe("either")
  })
})
