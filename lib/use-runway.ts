"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { computeExpenseInsight } from "@/lib/expense-insight"
import {
  findSavingsEnvelope,
  savingsBalance,
  sumRemainingDiscretionary,
} from "@/lib/savings-ui-metrics"
import { evaluateLoans, type LoanEvaluation } from "@/lib/loan-health"
import { toLoanHealthInput } from "@/lib/btc-loan"
import {
  buildRunwayComputation,
  effectiveBorrowCapFraction,
  resolveLivingBaselineUsd,
  type RunwayComputation,
  type RunwayPlanResponse,
} from "@/lib/runway-ui"
import type { ScenarioMode } from "@/lib/runway-need"
import {
  sumSaleHoldings,
  type PendingSaleStatus,
} from "@/lib/runway-refill"
import { suggestedStressPercent } from "@/lib/runway-stress"
import { useWalletWatches } from "@/lib/use-wallet-watch"
import { runwayWalletSats } from "@/lib/wallet-confirmed-sats"

/** Serialized loan row from GET /api/runway/loans. */
export interface RunwayLoan {
  id: string
  label: string
  principalUsd: number
  apr: number
  openedOn: string
  maturityOn: string
  collateralSats: number
  lenderSellPriceUsd: number
  payoffStyle: "accrued" | "full_bill"
  maturityBillOverrideUsd: number | null
  status: string
  createdAt: string
  updatedAt: string
}

/** Serialized pending-sale row from GET /api/runway/pending-sales. */
export interface RunwayPendingSale {
  id: string
  status: PendingSaleStatus
  sats: number
  markPriceUsd: number
  proceedsUsd: number | null
  linkedTransactionId: string | null
  createdAt: string
  updatedAt: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface UseRunwayResult {
  plan: RunwayPlanResponse | null
  setPlan: (
    plan:
      | RunwayPlanResponse
      | null
      | ((prev: RunwayPlanResponse | null) => RunwayPlanResponse | null),
  ) => void
  loading: boolean
  error: string | null
  reload: () => void
  /** Resolved monthly living costs (override → insight → 0). */
  livingBaselineUsd: number
  /** Recent-spend monthly average used as the living-cost placeholder. */
  insightMonthlyUsd: number
  /** Dollars/month freed if flexible envelopes return to usual spending. */
  flexibleCutMonthlyUsd: number
  envelopeCashUsd: number
  savingsUsd: number
  discretionaryUsd: number
  btcPriceUsd: number
  /** Spot bitcoin price, or null when no live price is available. */
  btcPriceOrNull: number | null
  loans: RunwayLoan[]
  loansEval: LoanEvaluation[]
  lenderHeldSats: number
  amountDueUsd: number
  reloadLoans: () => void
  /** Open bitcoin sales (sent / cash_on_the_way) in transit to the cash floor. */
  pendingSales: RunwayPendingSale[]
  reloadSales: () => void
  /** Sats in transit across open sales (counted so the stack value doesn't vanish). */
  bitcoinOnTheWaySats: number
  /** Cash in transit across open sales (proceeds known, deposit not yet linked). */
  cashOnTheWayUsd: number
  /** Estimated next paycheck while still earning (0 once on runway). */
  nextPaycheckUsd: number
  /**
   * Default stress percent suggested from historical bitcoin drawdowns. Seeds a
   * NEW plan only (see RunwaySetupDialog); never overwrites a saved plan's
   * stress. Falls back to the middle-path default when price history is sparse.
   */
  suggestedStressPercent: number
  /** Build the full need+gap computation for a given scenario mode. */
  compute: (scenarioMode: ScenarioMode) => RunwayComputation | null
}

/**
 * Shared data layer for the Runway page and dashboard card. Loads the plan,
 * resolves holdings from the budget (savings + discretionary remaining), derives
 * the recent-spend insight, and (optionally) loads loans for the borrow block.
 */
export function useRunway(opts?: { withLoans?: boolean }): UseRunwayResult {
  const withLoans = opts?.withLoans ?? false
  const { state, activeTransactions, discretionaryEnvelopes, currentUserId } = useApp()
  const { currentPrice, priceHistory } = useBtcPrices()

  const [plan, setPlanState] = useState<RunwayPlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loans, setLoans] = useState<RunwayLoan[]>([])
  const [loansKey, setLoansKey] = useState(0)
  const [pendingSales, setPendingSales] = useState<RunwayPendingSale[]>([])
  const [salesKey, setSalesKey] = useState(0)

  // Note: `loading` starts true and is re-armed inside `reload` (an event
  // handler), so the effect body itself performs no synchronous setState.
  useEffect(() => {
    let cancelled = false
    fetch("/api/runway/plan")
      .then(async (res) => {
        if (!res.ok) throw new Error("plan")
        return (await res.json()) as RunwayPlanResponse
      })
      .then((data) => {
        if (cancelled) return
        setPlanState(data)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your runway. Try again.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (!withLoans) return
    let cancelled = false
    fetch("/api/runway/loans")
      .then(async (res) => {
        if (!res.ok) throw new Error("loans")
        return (await res.json()) as { loans: RunwayLoan[] }
      })
      .then((data) => {
        if (!cancelled) setLoans(data.loans ?? [])
      })
      .catch(() => {
        /* loans are optional enrichment */
      })
    return () => {
      cancelled = true
    }
  }, [withLoans, loansKey])

  useEffect(() => {
    if (!withLoans) return
    let cancelled = false
    fetch("/api/runway/pending-sales")
      .then(async (res) => {
        if (!res.ok) throw new Error("sales")
        return (await res.json()) as { sales: RunwayPendingSale[] }
      })
      .then((data) => {
        if (!cancelled) setPendingSales(data.sales ?? [])
      })
      .catch(() => {
        /* pending sales are optional enrichment */
      })
    return () => {
      cancelled = true
    }
  }, [withLoans, salesKey])

  const savingsUsd = useMemo(
    () => savingsBalance(activeTransactions, findSavingsEnvelope(state.envelopes)),
    [activeTransactions, state.envelopes],
  )
  const discretionaryUsd = useMemo(
    () => sumRemainingDiscretionary(activeTransactions, discretionaryEnvelopes),
    [activeTransactions, discretionaryEnvelopes],
  )
  const envelopeCashUsd = Math.max(0, savingsUsd) + Math.max(0, discretionaryUsd)

  const insight = useMemo(
    () =>
      computeExpenseInsight({
        transactions: activeTransactions,
        envelopes: state.envelopes,
        priorities: plan?.envelopePriorities,
      }),
    [activeTransactions, state.envelopes, plan?.envelopePriorities],
  )
  const recentMonths = Math.max(1, insight.recentMonthKeys.length)
  const insightMonthlyUsd = insight.totalRecentDiscretionarySpend / recentMonths
  const flexibleCutMonthlyUsd = insight.totalDollarsKeptIfFlexibleReturned

  const btcPriceOrNull = currentPrice
  const btcPriceUsd = currentPrice ?? 0

  // Suggested default stress from historical drawdowns (seeds a new plan only).
  const suggestedStress = useMemo(
    () =>
      suggestedStressPercent(
        priceHistory.map((p) => ({ date: p.date, priceUsd: p.price })),
      ),
    [priceHistory],
  )

  const today = todayIso()

  const borrowCapFraction = useMemo(
    () => (plan ? effectiveBorrowCapFraction(plan) : 0),
    [plan],
  )

  const loansEval = useMemo<LoanEvaluation[]>(() => {
    const openLoans = loans.filter((l) => l.status === "open")
    if (openLoans.length === 0) return []
    return evaluateLoans(
      openLoans.map((l) =>
        toLoanHealthInput({
          id: l.id,
          principalUsd: l.principalUsd,
          apr: l.apr,
          openedOn: l.openedOn,
          maturityOn: l.maturityOn,
          collateralSats: l.collateralSats,
          lenderSellPriceUsd: l.lenderSellPriceUsd,
          payoffStyle: l.payoffStyle,
          maturityBillOverrideUsd: l.maturityBillOverrideUsd,
        }),
      ),
      { btcPriceUsd, asOfDate: today, borrowCapFraction },
    ).loans
  }, [loans, btcPriceUsd, today, borrowCapFraction])

  const lenderHeldSats = useMemo(
    () => loans.filter((l) => l.status === "open").reduce((s, l) => s + l.collateralSats, 0),
    [loans],
  )
  const amountDueUsd = useMemo(
    () => loansEval.reduce((s, l) => s + l.amountDueTodayUsd, 0),
    [loansEval],
  )

  const { bitcoinOnTheWaySats, cashOnTheWayUsd, reservedForSaleSats } = useMemo(() => {
    const open = pendingSales.filter(
      (s) => s.status === "sent" || s.status === "cash_on_the_way",
    )
    const holdings = sumSaleHoldings(open)
    const reservedForSaleSats = open.reduce((s, sale) => s + Math.max(0, sale.sats), 0)
    return { ...holdings, reservedForSaleSats }
  }, [pendingSales])

  const watches = useWalletWatches(currentUserId)
  const livingBaselineUsd = plan
    ? resolveLivingBaselineUsd(plan, insightMonthlyUsd)
    : 0
  const monthlySavingsUsd = Math.max(0, state.monthlyIncome - livingBaselineUsd)
  // While still building up (not yet living off savings), the next paycheck can
  // chip at a cash-floor shortfall. Use monthly income as the paycheck estimate.
  const nextPaycheckUsd =
    plan && plan.phase !== "runway" ? Math.max(0, state.monthlyIncome) : 0
  const walletSats = useMemo(
    () => runwayWalletSats(watches, reservedForSaleSats),
    [watches, reservedForSaleSats],
  )

  const compute = useCallback(
    (scenarioMode: ScenarioMode): RunwayComputation | null => {
      if (!plan) return null
      return buildRunwayComputation({
        plan,
        livingBaselineUsd,
        envelopeCashUsd,
        walletSats,
        lenderHeldSats,
        amountDueUsd,
        btcPriceUsd,
        todayIso: today,
        scenarioMode,
        monthlySavingsUsd,
        flexibleCutMonthlyUsd,
        bitcoinOnTheWaySats,
        cashOnTheWayUsd,
        reservedForSaleSats,
      })
    },
    [
      plan,
      livingBaselineUsd,
      envelopeCashUsd,
      walletSats,
      lenderHeldSats,
      amountDueUsd,
      btcPriceUsd,
      today,
      monthlySavingsUsd,
      flexibleCutMonthlyUsd,
      bitcoinOnTheWaySats,
      cashOnTheWayUsd,
      reservedForSaleSats,
    ],
  )

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])
  const reloadLoans = useCallback(() => setLoansKey((k) => k + 1), [])
  const reloadSales = useCallback(() => setSalesKey((k) => k + 1), [])

  return {
    plan,
    setPlan: setPlanState,
    loading,
    error,
    reload,
    livingBaselineUsd,
    insightMonthlyUsd,
    flexibleCutMonthlyUsd,
    envelopeCashUsd,
    savingsUsd,
    discretionaryUsd,
    walletSats,
    watchCount: watches.length,
    btcPriceUsd,
    btcPriceOrNull,
    loans,
    loansEval,
    lenderHeldSats,
    amountDueUsd,
    reloadLoans,
    pendingSales,
    reloadSales,
    bitcoinOnTheWaySats,
    cashOnTheWayUsd,
    nextPaycheckUsd,
    suggestedStressPercent: suggestedStress,
    compute,
  }
}
