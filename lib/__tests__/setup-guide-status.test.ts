import { describe, expect, it } from "vitest"
import {
  allocationsComplete,
  computeSetupGuideTasks,
  hasIncomeSignal,
  needsAllotmentSetupTracking,
  needsMonthlyIncomeSetupTracking,
  needsTransactionSetupTracking,
  setupGuideProgress,
  shouldShowSetupGuideOnDashboard,
  type SetupGuideTaskStatus,
} from "@/lib/setup-guide-status"
import type { Envelope, Transaction } from "@/lib/data"

function env(partial: Partial<Envelope> & { id: string; name: string }): Envelope {
  return {
    id: partial.id,
    name: partial.name,
    color: partial.color ?? "#F7931A",
    icon: partial.icon ?? "shopping-cart",
    monthlyAllotment: partial.monthlyAllotment ?? 0,
    archived: partial.archived ?? false,
    systemRole: partial.systemRole ?? null,
  }
}

function txn(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    id: partial.id,
    envelopeId: partial.envelopeId ?? "e1",
    date: partial.date ?? "2026-05-01",
    payee: partial.payee ?? "enc",
    amount: partial.amount ?? 10,
    type: partial.type ?? "expense",
    tags: partial.tags ?? [],
    source: partial.source,
    excludeFromMainHistory: partial.excludeFromMainHistory,
  }
}

describe("setup-guide-status", () => {
  it("requires every discretionary envelope to have allotment", () => {
    const envelopes = [
      env({ id: "s", name: "Savings", systemRole: "savings", monthlyAllotment: 100 }),
      env({ id: "a", name: "Food", monthlyAllotment: 200 }),
      env({ id: "b", name: "Fun", monthlyAllotment: 0 }),
    ]
    expect(allocationsComplete([envelopes[1], envelopes[2]], 1000, [])).toBe(false)
    envelopes[2].monthlyAllotment = 50
    expect(allocationsComplete([envelopes[1], envelopes[2]], 1000, [])).toBe(true)
  })

  it("counts premium tasks only when premium", () => {
    const base = {
      monthlyIncome: 1000,
      envelopes: [env({ id: "a", name: "Food", monthlyAllotment: 500 })],
      transactions: [txn({ id: "t1" })] as const,
      hasAccountEmail: true,
      savingsGoalSet: true,
      hasPlaidLink: true,
      hasReceiptInboxActivity: false,
    }
    const free = computeSetupGuideTasks({ ...base, hasPremiumFeatures: false })
    expect(free.map((t) => t.id)).not.toContain("plaid")
    const premium = computeSetupGuideTasks({ ...base, hasPremiumFeatures: true })
    expect(premium.map((t) => t.id)).toContain("plaid")
  })

  it("shouldShowSetupGuideOnDashboard respects snooze and dismiss", () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(
      shouldShowSetupGuideOnDashboard({
        showOnDashboard: true,
        dismissed: false,
        snoozedUntil: future,
        allComplete: false,
      }),
    ).toBe(false)
    expect(
      shouldShowSetupGuideOnDashboard({
        showOnDashboard: true,
        dismissed: true,
        snoozedUntil: null,
        allComplete: false,
      }),
    ).toBe(false)
    expect(
      shouldShowSetupGuideOnDashboard({
        showOnDashboard: true,
        dismissed: false,
        snoozedUntil: null,
        allComplete: true,
      }),
    ).toBe(false)
  })

  it("setupGuideProgress reports all complete", () => {
    const tasks = computeSetupGuideTasks({
      monthlyIncome: 2000,
      envelopes: [env({ id: "a", name: "Food", monthlyAllotment: 2000 })],
      transactions: [txn({ id: "t1" })],
      hasAccountEmail: true,
      hasPremiumFeatures: false,
      savingsGoalSet: true,
      hasPlaidLink: false,
      hasReceiptInboxActivity: false,
    })
    const p = setupGuideProgress(tasks)
    expect(p.allComplete).toBe(false)
    expect(p.totalCount).toBe(6)
  })

  it("needsTransactionSetupTracking stops when txn tasks done", () => {
    const txnDone: SetupGuideTaskStatus[] = [
      { id: "income", complete: true },
      { id: "first_expense", complete: true },
      { id: "first_sweep", complete: true },
      { id: "savings_goal", complete: false },
    ]
    expect(needsTransactionSetupTracking(txnDone, 5000)).toBe(false)
    expect(needsAllotmentSetupTracking(txnDone)).toBe(false)
    expect(needsMonthlyIncomeSetupTracking(txnDone)).toBe(false)

    const withOpenAllocations: SetupGuideTaskStatus[] = [
      ...txnDone,
      { id: "allocations", complete: false },
    ]
    expect(needsAllotmentSetupTracking(withOpenAllocations)).toBe(true)
    expect(needsMonthlyIncomeSetupTracking(withOpenAllocations)).toBe(true)
  })

  it("needsTransactionSetupTracking keeps income watch when funded via credits only", () => {
    const tasks: SetupGuideTaskStatus[] = [{ id: "income", complete: true }]
    expect(needsTransactionSetupTracking(tasks, 0)).toBe(true)
    expect(needsTransactionSetupTracking(tasks, 1000)).toBe(false)
  })

  it("hasIncomeSignal accepts funded credits", () => {
    expect(hasIncomeSignal(0, [])).toBe(false)
    expect(
      hasIncomeSignal(
        0,
        [
          txn({
            id: "c1",
            type: "credit",
            source: "paycheck",
            date: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-15`,
          }),
        ],
      ),
    ).toBe(true)
  })
})
