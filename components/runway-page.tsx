"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { getCurrentMonthKey, formatUsd } from "@/lib/data"
import { useRunway, type RunwayLoan, type RunwayPendingSale } from "@/lib/use-runway"
import { RunwaySetupDialog } from "@/components/runway-setup-dialog"
import { RunwayLoanDialog } from "@/components/runway-loan-dialog"
import { RunwayRefillDialog } from "@/components/runway-refill-dialog"
import { RunwayAddressWatch } from "@/components/runway-address-watch"
import { refillStatus } from "@/lib/runway-refill"
import {
  borrowingAllowed,
  buildPlanPutBody,
  checkupMonthName,
  formatLiquidationRoomPct,
  formatSharePct,
  holdingsAfterSaleLinked,
  isCheckupReady,
  isRunwayConfigured,
  mergeSavedPlan,
  runwayHeroDetail,
  runwayHoldingStatus,
  runwayMonthsHeadline,
  runwayMoneyLabel,
  runwayPrimaryAction,
  parseHoldingsOverrides,
  rollbackPlanPatch,
  RUNWAY_JUST_SETUP_KEY,
  satsToUsd,
  type RunwayPlanResponse,
} from "@/lib/runway-ui"
import type { PlannedLine, RunwayScenario } from "@/lib/runway-need"
import {
  computeMonthsLeftImpact,
  formatMonthsLeft,
} from "@/lib/runway-expense-impact"
import type { LoanEvaluation } from "@/lib/loan-health"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  AlertCircle,
  ArrowDownToLine,
  Bitcoin,
  CalendarCheck,
  ChevronDown,
  Plane,
  Plus,
  Settings2,
  Trash2,
  Wallet,
  X,
} from "lucide-react"

const SATS_PER_BTC = 100_000_000

function newId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function MixBar({
  label,
  share,
  color,
}: {
  label: string
  share: number
  color: string
}) {
  const pct = Math.round(Math.max(0, Math.min(1, share)) * 100)
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-foreground tabular-nums">{formatSharePct(share)}</span>
      </div>
      <div className="h-2 rounded-full bg-[#1F1F1F] overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function LoanRow({
  loan,
  evaluation,
  priceKnown,
  onDelete,
}: {
  loan: RunwayLoan
  evaluation: LoanEvaluation | undefined
  priceKnown: boolean
  onDelete: () => void
}) {
  const roomPct = evaluation?.liquidationRoom.percent
  const roomBreached = roomPct != null && roomPct < 0
  const roomTone =
    roomPct == null
      ? "text-muted-foreground"
      : roomPct < 0
        ? "text-red-400"
        : roomPct < 0.15
          ? "text-amber-400"
          : "text-[#22C55E]"
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-medium text-sm text-foreground truncate min-w-0">{loan.label}</span>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-muted-foreground hover:text-amber-400 transition-colors shrink-0"
          aria-label={`Remove ${loan.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col">
          <span className="text-muted-foreground">Bill due</span>
          <span className="text-foreground tabular-nums">
            {runwayMoneyLabel(evaluation ? evaluation.amountDueTodayUsd : loan.principalUsd)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">Due date</span>
          <span className="text-foreground tabular-nums">{loan.maturityOn}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">Room before sell price</span>
          <span className={`tabular-nums ${roomTone}`}>
            {priceKnown && roomPct != null ? formatLiquidationRoomPct(roomPct) : "—"}
          </span>
        </div>
      </div>
      {priceKnown && roomBreached && (
        <p className="text-xs text-red-400">
          Bitcoin is already below the lender&apos;s sell price — this loan could be liquidated.
        </p>
      )}
      {priceKnown && evaluation && !evaluation.rolloverCoversBillAtToday && (
        <p className="text-xs text-amber-400/90">
          At today&apos;s price, a new loan on this bitcoin wouldn&apos;t fully cover the bill.
        </p>
      )}
    </div>
  )
}

export function RunwayPage() {
  const { state, navigateTo, runwayWhatIfUsd, setRunwayWhatIf } = useApp()
  const {
    plan,
    setPlan,
    loading,
    error,
    reload,
    insightMonthlyUsd: livingPlaceholder,
    envelopeCashUsd,
    walletSats,
    btcPriceOrNull,
    loans,
    loansEval,
    reloadLoans,
    pendingSales,
    reloadSales,
    nextPaycheckUsd,
    btcPriceUsd,
    watchCount,
    suggestedStressPercent,
    holdingsReady,
    compute,
  } = useRunway()

  const [setupOpen, setSetupOpen] = useState(false)
  const [applyScenarios, setApplyScenarios] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [loanPrefill, setLoanPrefill] = useState<
    { principalUsd?: number; collateralBtc?: number } | null
  >(null)
  const [refillOpen, setRefillOpen] = useState(false)
  const [editTotals, setEditTotals] = useState(false)
  const [scenariosOpen, setScenariosOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loanToDelete, setLoanToDelete] = useState<RunwayLoan | null>(null)

  const monthKey = getCurrentMonthKey()
  const configured = isRunwayConfigured(plan)
  const checkupReady = isCheckupReady(plan, monthKey)
  const [showCheckup, setShowCheckup] = useState(false)
  // First Finish this visit should not immediately look like a monthly failure.
  // Read the flag after mount: a useState initializer sees no sessionStorage
  // during SSR, and hydration keeps that false value.
  const [sessionReady, setSessionReady] = useState(false)
  const [justSetup, setJustSetup] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => {
      setJustSetup(sessionStorage.getItem(RUNWAY_JUST_SETUP_KEY) === "1")
      setSessionReady(true)
    }, 0)
    return () => window.clearTimeout(id)
  }, [])
  const onPlanSaved = (saved: RunwayPlanResponse) => {
    setPlan(saved)
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(RUNWAY_JUST_SETUP_KEY) === "1") {
      setJustSetup(true)
    }
  }

  // Mark this month's checkup opened once the user lands here (clears the card
  // prompt). The banner stays visible for this visit via `showCheckup`.
  // Merge only the checkup key into whatever plan is current — never rebuild
  // from a stale `plan` closure, or a concurrent totals/scenario save is lost.
  const markedRef = useRef(false)
  const planRef = useRef(plan)
  useEffect(() => {
    planRef.current = plan
  }, [plan])
  useEffect(() => {
    if (!sessionReady || !configured || !checkupReady || justSetup || markedRef.current || !planRef.current) return
    markedRef.current = true
    const t = setTimeout(() => setShowCheckup(true), 0)
    fetch("/api/runway/checkup/opened", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthKey }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.checkupOpenedMonthKey === "string") {
          const key = data.checkupOpenedMonthKey as string
          setPlan((prev) =>
            prev ? { ...prev, checkupOpenedMonthKey: key } : prev,
          )
        }
      })
      .catch(() => {
        /* best-effort */
      })
    return () => clearTimeout(t)
  }, [configured, checkupReady, justSetup, sessionReady, monthKey, setPlan])

  const scenarioMode = applyScenarios ? "enabled" : "none"
  const comp = useMemo(() => compute(scenarioMode), [compute, scenarioMode])

  // The transient "See this on your plan" what-if is a preview only — never
  // persisted. Clear it when the user navigates away from Runway.
  useEffect(() => {
    return () => setRunwayWhatIf(null)
  }, [setRunwayWhatIf])

  const savePatch = useCallback(
    async (patch: Partial<RunwayPlanResponse>): Promise<boolean> => {
      const current = planRef.current
      if (!current) return false
      const optimistic = { ...current, ...patch }
      setPlan(optimistic)
      setSaveError(null)
      try {
        const res = await fetch("/api/runway/plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPlanPutBody(current, patch)),
        })
        if (!res.ok) {
          setPlan((prev) => (prev ? rollbackPlanPatch(prev, current, patch) : current))
          setSaveError("Couldn't save that change. Your runway is unchanged.")
          return false
        }
        const saved = (await res.json()) as RunwayPlanResponse
        setPlan((prev) => (prev ? mergeSavedPlan(prev, optimistic, saved, patch) : saved))
        return true
      } catch {
        setPlan((prev) => (prev ? rollbackPlanPatch(prev, current, patch) : current))
        setSaveError("Couldn't save that change. Check your connection and try again.")
        return false
      }
    },
    [setPlan],
  )

  const linkSale = useCallback(
    async (sale: RunwayPendingSale): Promise<string | null> => {
      const current = planRef.current
      if (!current) return "Couldn't update your totals."
      const adjustment = holdingsAfterSaleLinked(current, sale, envelopeCashUsd)
      const saved = await savePatch(adjustment)
      if (!saved) return "Couldn't update your totals. The deposit is still on the way."
      try {
        const res = await fetch(`/api/runway/pending-sales?id=${encodeURIComponent(sale.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "linked" }),
        })
        if (!res.ok) {
          await savePatch({
            bitcoinOverrideSats: current.bitcoinOverrideSats,
            cashOverrideUsd: current.cashOverrideUsd,
          })
          setSaveError("Couldn't link the deposit, so your totals were put back.")
          return "Couldn't link the deposit, so your totals were put back."
        }
        reloadSales()
        return null
      } catch {
        await savePatch({
          bitcoinOverrideSats: current.bitcoinOverrideSats,
          cashOverrideUsd: current.cashOverrideUsd,
        })
        setSaveError("Couldn't link the deposit, so your totals were put back.")
        return "Couldn't link the deposit, so your totals were put back."
      }
    },
    [envelopeCashUsd, reloadSales, savePatch],
  )

  // Gate first: a user who reaches #/runway with bitcoin features off (e.g. a
  // stale hash) sees the calm redirect immediately, not a spinner for content
  // they can't use.
  if (!state.opportunityCostEnabled) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 bg-[#0D0D0D] rounded-2xl text-center px-6">
        <div className="p-4 rounded-full bg-[#F7931A]/10">
          <Plane className="h-6 w-6 text-[#F7931A]" aria-hidden />
        </div>
        <p className="text-foreground font-semibold text-lg">Runway is part of the bitcoin experience</p>
        <p className="text-muted-foreground text-sm max-w-sm">
          Turn on Opportunity Cost in Settings to plan how long your money lasts.
        </p>
        <Button variant="outline" className="border-[#333]" onClick={() => navigateTo("settings")}>
          Open Settings
        </Button>
      </div>
    )
  }

  if (loading || !holdingsReady) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-label="Loading your runway">
        <Spinner className="h-8 w-8 text-[#F7931A]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 bg-[#0D0D0D] rounded-2xl text-center px-6">
        <AlertCircle className="h-6 w-6 text-amber-400" aria-hidden />
        <p className="text-muted-foreground text-sm">{error}</p>
        <Button variant="outline" className="border-[#333]" onClick={reload}>
          Try again
        </Button>
      </div>
    )
  }

  // Empty state — invite to set up.
  if (!configured || !plan) {
    return (
      <div className="flex flex-col gap-6 min-w-0 w-full max-w-full">
        <div className="flex flex-col items-center text-center gap-5 py-12 md:py-16 px-6 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
          <div className="p-4 rounded-2xl bg-[#F7931A]/10">
            <Plane className="h-7 w-7 text-[#F7931A]" aria-hidden />
          </div>
          <div className="flex flex-col gap-2 max-w-md">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Plan your runway</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              See how long your money would last if you stepped back from work — and what it takes to
              get there. We&apos;ll use your savings, your bitcoin, and a few quick questions to map it
              out.
            </p>
          </div>
          <Button
            className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 w-full sm:w-auto"
            onClick={() => setSetupOpen(true)}
          >
            Set up my runway
          </Button>
        </div>
        <RunwaySetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          plan={plan}
          livingPlaceholderUsd={livingPlaceholder}
          suggestedStressPercent={suggestedStressPercent}
          askCash={
            runwayHoldingStatus({
              cashUsd: envelopeCashUsd,
              bitcoinSats: walletSats,
              cashOverrideUsd: plan?.cashOverrideUsd ?? null,
              bitcoinOverrideSats: plan?.bitcoinOverrideSats ?? null,
              watchCount,
            }).cashUnset
          }
          askBitcoin={
            runwayHoldingStatus({
              cashUsd: envelopeCashUsd,
              bitcoinSats: walletSats,
              cashOverrideUsd: plan?.cashOverrideUsd ?? null,
              bitcoinOverrideSats: plan?.bitcoinOverrideSats ?? null,
              watchCount,
            }).bitcoinUnset
          }
          onSaved={onPlanSaved}
        />
      </div>
    )
  }

  const need = comp?.need
  const gap = comp?.gap
  const priceKnown = btcPriceOrNull != null && btcPriceOrNull > 0
  const scenarios = plan.scenarios

  const bitcoinSats = need?.spendableSats ?? 0
  const bitcoinKnownUsd = need ? satsToUsd(bitcoinSats, btcPriceOrNull ?? 0) : 0
  const monthsUntil = comp?.monthsUntilQuit ?? 0
  const alreadySteppedBack = plan.phase === "runway"
  const holdings = runwayHoldingStatus({
    cashUsd: need?.cashUsd ?? 0,
    bitcoinSats,
    cashOverrideUsd: plan.cashOverrideUsd,
    bitcoinOverrideSats: plan.bitcoinOverrideSats,
    watchCount,
    priceKnown,
  })
  const { cashUnset, bitcoinUnset } = holdings

  const refill = need
    ? refillStatus({
        cashUsd: need.cashUsd,
        cashOnTheWayUsd: need.cashOnTheWayUsd,
        cashFloorUsd: need.cashFloorUsedUsd,
        monthlyDrawUsd: need.monthlyDrawUsd,
      })
    : null
  const openSales = pendingSales.filter(
    (s) => s.status === "sent" || s.status === "cash_on_the_way",
  )
  const primary = runwayPrimaryAction({
    holdingsEmpty: holdings.holdingsEmpty,
    cashUnset,
    bitcoinUnset,
    bitcoinUnpriced: holdings.bitcoinUnpriced,
    underFloor: Boolean(refill?.underFloor),
  })
  const heroDetail =
    need && gap
      ? runwayHeroDetail({
          holdingsEmpty: holdings.holdingsEmpty,
          cashUnset,
          bitcoinUnset,
          bitcoinUnpriced: holdings.bitcoinUnpriced,
          underFloor: Boolean(refill?.underFloor),
          shortfallUsd: refill?.shortfallUsd ?? 0,
          projectedCashGapUsd: gap.flat.cashGapUsd,
          projectedBitcoinGapUsd: gap.flat.bitcoinGapUsd,
          alreadySteppedBack,
        })
      : ""
  const headline = runwayMonthsHeadline(need?.monthsLeft ?? null, {
    holdingsEmpty: holdings.holdingsEmpty,
    bitcoinUnpriced: holdings.bitcoinUnpriced,
  })
  const openLoans = loans.filter((l) => l.status === "open")

  const whatIfImpact =
    runwayWhatIfUsd != null && need && need.monthlyDrawUsd > 0
      ? computeMonthsLeftImpact({
          liquidTodayUsd: (need.monthsLeft ?? 0) * need.monthlyDrawUsd,
          monthlyDrawUsd: need.monthlyDrawUsd,
          expenseUsd: runwayWhatIfUsd,
          liquidStressUsd:
            need.monthsLeftAtStress != null
              ? need.monthsLeftAtStress * need.monthlyDrawUsd
              : null,
        })
      : null

  return (
    <div className="flex flex-col gap-4 md:gap-6 min-w-0 w-full max-w-full pb-24 md:pb-0">
      {/* Header — stacks on narrow phones so Adjust never crowds the title */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="p-2 rounded-xl bg-[#F7931A]/10 shrink-0">
            <Plane className="h-5 w-5 text-[#F7931A]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-foreground">Your runway</h1>
            <p className="text-xs text-muted-foreground">
              {plan.phase === "runway"
                ? "Living off your savings"
                : monthsUntil > 0
                  ? `Stepping back in about ${monthsUntil} month${monthsUntil === 1 ? "" : "s"}`
                  : "Planning your step back"}
            </p>
          </div>
        </div>
      </div>

      {saveError && (
        <p className="text-sm text-amber-400/95" role="alert">
          {saveError}
        </p>
      )}

      {need && (
        <div className="flex flex-col gap-3 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F] min-w-0">
          <p className="text-3xl md:text-4xl font-bold text-foreground tracking-tight min-h-[2.75rem]">
            {headline}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed min-h-[2.75rem] max-w-prose">
            {heroDetail}
          </p>
          {primary === "add_holdings" && (
            <Button
              className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 w-full sm:w-auto"
              onClick={() => setEditTotals(true)}
            >
              Add what you have
            </Button>
          )}
          {primary === "refill_cushion" && (
            <Button
              className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 w-full sm:w-auto"
              onClick={() => setRefillOpen(true)}
            >
              <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Refill the cushion
            </Button>
          )}
        </div>
      )}

      {/* Temporary "See this on your plan" what-if preview */}
      {runwayWhatIfUsd != null && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#F7931A]/30 bg-[#F7931A]/5 p-4">
          <Plane className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Previewing a {formatUsd(runwayWhatIfUsd)} expense
            </p>
            <p className="text-xs text-muted-foreground">
              {whatIfImpact
                ? `Spending this once would shorten your runway from ${formatMonthsLeft(
                    whatIfImpact.monthsBefore,
                  )} to ${formatMonthsLeft(whatIfImpact.monthsAfter)}${
                    whatIfImpact.monthsBeforeStress != null &&
                    whatIfImpact.monthsAfterStress != null
                      ? ` (${formatMonthsLeft(whatIfImpact.monthsBeforeStress)} to ${formatMonthsLeft(
                          whatIfImpact.monthsAfterStress,
                        )} if bitcoin dips)`
                      : ""
                  }. Nothing is saved — this is just a preview.`
                : "We can't preview this against your runway right now — your plan has no monthly draw to shorten."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRunwayWhatIf(null)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Dismiss expense preview"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {sessionReady && !justSetup && (showCheckup || checkupReady) && (
        <p className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
          <CalendarCheck className="h-3.5 w-3.5 text-[#F7931A] shrink-0" aria-hidden />
          <span className="min-w-0">{checkupMonthName(monthKey)} check-in — anything changed since last month?</span>
        </p>
      )}

      {need && (
        <div className="flex flex-col gap-3 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F] min-w-0">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">What you have today</span>
          {!editTotals ? (
            <div className="grid grid-cols-2 gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setEditTotals(true)}
                className="rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 text-left min-w-0"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden /> Cash
                </span>
                <span className="block text-base sm:text-lg font-semibold text-foreground tabular-nums mt-1 break-words">
                  {cashUnset ? "Add your cash" : formatUsd(need.cashUsd)}
                </span>
                <span className="text-[11px] text-muted-foreground block mt-0.5">
                  {cashUnset
                    ? "Tap to enter"
                    : plan.cashOverrideUsd != null
                      ? "You typed this — clears back to your savings and envelopes"
                      : "From your savings and envelopes"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setEditTotals(true)}
                className="rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 text-left min-w-0"
              >
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Bitcoin className="h-3.5 w-3.5 shrink-0" aria-hidden /> Bitcoin
                </span>
                <span className="block text-base sm:text-lg font-semibold text-foreground tabular-nums mt-1 break-words">
                  {bitcoinUnset ? "Add your bitcoin" : priceKnown ? formatUsd(bitcoinKnownUsd) : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground block mt-0.5">
                  {plan.bitcoinOverrideSats != null
                    ? watchCount > 0
                      ? "You typed this. Watched wallets are not included."
                      : "You typed this"
                    : watchCount > 0
                      ? "From wallets you watch"
                      : bitcoinUnset
                        ? "Tap to enter"
                        : "From your wallet"}
                </span>
              </button>
            </div>
          ) : (
            <TotalsEditor
              plan={plan}
              watchCount={watchCount}
              onSave={savePatch}
              onDone={() => setEditTotals(false)}
            />
          )}
        </div>
      )}

      {/* What-if scenarios */}
      {need && gap && (
        <Collapsible open={scenariosOpen} onOpenChange={setScenariosOpen}>
          <div className="bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F] overflow-hidden">
            <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 p-4 md:p-5 text-left">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-foreground">More</span>
                <p className="text-xs text-muted-foreground">
                  Bitcoin share, addresses you watch, what-ifs, bills, and loans.
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${scenariosOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 md:px-5 pb-5 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm text-foreground">
                  You wanted about {formatSharePct(need.targetBtcShare)} of your savings in bitcoin.
                </p>
                <MixBar label="Right now" share={need.actualBtcShare} color="#F7931A" />
                <p className="text-xs text-muted-foreground">
                  {holdings.holdingsEmpty
                    ? "Add what you have above before this cushion means much."
                    : `Cash cushion: ${formatUsd(need.cashFloorUsedUsd)} — about ${need.cashFloorMonths} month${
                        need.cashFloorMonths === 1 ? "" : "s"
                      } of spending kept in cash.${
                        cashUnset
                          ? ""
                          : refill?.underFloor
                            ? ` Short ${formatUsd(refill.shortfallUsd)} today.`
                            : " You're at or above that cushion today."
                      }`}
                </p>
                <RunwayAddressWatch />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-foreground">What if…</span>
              {scenarios.length > 0 && (
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3">
                  <span className="text-sm text-foreground">Preview these in my runway above</span>
                  <Switch checked={applyScenarios} onCheckedChange={setApplyScenarios} aria-label="Preview scenarios in runway" />
                </label>
              )}
              {scenarios.length === 0 && (
                <p className="text-sm text-muted-foreground">No what-ifs yet. Add one below.</p>
              )}
              {scenarios.map((sc, i) => {
                const closure = gap.scenarios[i]
                const closedUsd =
                  (closure?.cashGapClosedUsd ?? 0) +
                  (Number.isFinite(closure?.bitcoinGapClosedUsd ?? 0) ? closure?.bitcoinGapClosedUsd ?? 0 : 0)
                return (
                  <div key={sc.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 min-w-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground block truncate">{sc.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {sc.monthlyDeltaUsd !== 0 && (
                          <>{sc.monthlyDeltaUsd < 0 ? "Frees " : "Adds "}{formatUsd(Math.abs(sc.monthlyDeltaUsd))}/mo</>
                        )}
                        {sc.monthlyDeltaUsd !== 0 && sc.oneTimeUsd !== 0 && " · "}
                        {sc.oneTimeUsd !== 0 && (
                          <>{sc.oneTimeUsd > 0 ? "One-time " : "Costs "}{formatUsd(Math.abs(sc.oneTimeUsd))}</>
                        )}
                        {closedUsd > 0.5 && <> · shrinks what you&apos;re short by {formatUsd(closedUsd)}</>}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void savePatch({ scenarios: scenarios.filter((s) => s.id !== sc.id) })}
                      className="p-1 text-muted-foreground hover:text-amber-400 transition-colors shrink-0"
                      aria-label={`Remove ${sc.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                )
              })}
              <ScenarioAdder
                onAdd={(sc) => void savePatch({ scenarios: [...scenarios, sc] })}
              />
              </div>
              <BillList
                lines={plan.plannedLines}
                onChange={(plannedLines) => void savePatch({ plannedLines })}
              />
              {borrowingAllowed(plan) && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-semibold text-foreground">Loans on your bitcoin</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#333] w-full sm:w-auto"
                      onClick={() => setLoanOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
                      Add loan
                    </Button>
                  </div>
                  {openLoans.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {openLoans.map((loan) => (
                        <LoanRow
                          key={loan.id}
                          loan={loan}
                          evaluation={loansEval.find((e) => e.id === loan.id)}
                          priceKnown={priceKnown}
                          onDelete={() => setLoanToDelete(loan)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="border-[#333] w-full sm:w-auto self-start"
                onClick={() => setSetupOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Adjust plan
              </Button>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Sales in progress */}
      {openSales.length > 0 && (
        <PendingSalesSection
          sales={openSales}
          onChanged={reloadSales}
          onLink={linkSale}
        />
      )}

      <RunwaySetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        plan={plan}
        livingPlaceholderUsd={livingPlaceholder}
        suggestedStressPercent={suggestedStressPercent}
        askCash={cashUnset}
        askBitcoin={bitcoinUnset}
        onSaved={onPlanSaved}
      />
      <RunwayLoanDialog
        open={loanOpen}
        onOpenChange={(next) => {
          setLoanOpen(next)
          if (!next) setLoanPrefill(null)
        }}
        onSaved={reloadLoans}
        prefill={loanPrefill}
      />
      {need && (
        <RunwayRefillDialog
          open={refillOpen}
          onOpenChange={setRefillOpen}
          shortfallUsd={refill?.shortfallUsd ?? 0}
          btcPriceUsd={btcPriceUsd}
          priceKnown={priceKnown}
          borrowCapFraction={need.borrowCapFraction}
          stack={{
            cashUsd: need.cashUsd,
            cashOnTheWayUsd: need.cashOnTheWayUsd,
            walletSats: need.spendableSats,
            lenderHeldSats: need.lenderHeldSats,
            bitcoinOnTheWaySats: need.bitcoinOnTheWaySats,
            amountDueUsd: need.amountDueUsd,
            btcPriceUsd,
          }}
          rolloverCollateralSats={need.lenderHeldSats}
          openLoanAmountDueUsd={need.amountDueUsd}
          preferBorrow={plan.borrowStance === "ok"}
          nextPaycheckUsd={nextPaycheckUsd}
          onSaleCreated={reloadSales}
          onStartBorrow={(prefill) => {
            setLoanPrefill(prefill)
            setLoanOpen(true)
          }}
        />
      )}

      <AlertDialog open={loanToDelete != null} onOpenChange={(next) => { if (!next) setLoanToDelete(null) }}>
        <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,28rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this loan?</AlertDialogTitle>
            <AlertDialogDescription>
              {loanToDelete
                ? `${loanToDelete.label} will drop out of your runway, including its bill and the bitcoin held as collateral.`
                : "This loan will drop out of your runway."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333]">Keep loan</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500/90 text-[#0D0D0D] hover:bg-amber-500"
              onClick={() => {
                const id = loanToDelete?.id
                setLoanToDelete(null)
                if (!id) return
                void fetch(`/api/runway/loans?id=${encodeURIComponent(id)}`, { method: "DELETE" })
                  .then((res) => {
                    if (!res.ok) setSaveError("Couldn't remove that loan.")
                    reloadLoans()
                  })
                  .catch(() => setSaveError("Couldn't remove that loan. Check your connection and try again."))
              }}
            >
              Remove loan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PendingSalesSection({
  sales,
  onChanged,
  onLink,
}: {
  sales: RunwayPendingSale[]
  onChanged: () => void
  /** Saves totals, then marks the sale linked. Returns an error string, or null. */
  onLink: (sale: RunwayPendingSale) => Promise<string | null>
}) {
  return (
    <div className="flex flex-col gap-3 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
      <div className="flex items-center gap-2 min-w-0">
        <ArrowDownToLine className="h-4 w-4 text-[#F7931A] shrink-0" aria-hidden />
        <span className="text-sm font-semibold text-foreground">Refills on the way</span>
      </div>
      <p className="text-xs text-muted-foreground">
        We keep this money in your total while it travels, so nothing looks like it
        vanished. Update each one as the cash lands.
      </p>
      <div className="flex flex-col gap-2">
        {sales.map((sale) => (
          <PendingSaleRow
            key={sale.id}
            sale={sale}
            onChanged={onChanged}
            onLink={onLink}
          />
        ))}
      </div>
    </div>
  )
}

function PendingSaleRow({
  sale,
  onChanged,
  onLink,
}: {
  sale: RunwayPendingSale
  onChanged: () => void
  onLink: (sale: RunwayPendingSale) => Promise<string | null>
}) {
  const [recording, setRecording] = useState(false)
  const [proceeds, setProceeds] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`/api/runway/pending-sales?id=${encodeURIComponent(sale.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Couldn't update this sale.")
          return
        }
        onChanged()
      } catch {
        setError("Network error — try again.")
      } finally {
        setBusy(false)
      }
    },
    [sale.id, onChanged],
  )

  const linkDeposit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const message = await onLink(sale)
      if (message) setError(message)
    } finally {
      setBusy(false)
    }
  }, [onLink, sale])

  const btcLabel = (sale.sats / SATS_PER_BTC).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  })

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-sm text-foreground truncate min-w-0">
          {sale.status === "sent"
            ? `Bitcoin on the way — about ${btcLabel} BTC`
            : `Cash on the way — ${formatUsd(sale.proceedsUsd ?? 0)}`}
        </span>
        <button
          type="button"
          onClick={() => setCancelOpen(true)}
          disabled={busy}
          className="p-1 text-muted-foreground hover:text-amber-400 transition-colors shrink-0"
          aria-label="Cancel this sale"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {sale.status === "sent" && !recording && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-[#333] self-start"
          onClick={() => setRecording(true)}
        >
          Cash received
        </Button>
      )}

      {sale.status === "sent" && recording && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <Label htmlFor={`proceeds-${sale.id}`}>Cash you received (USD)</Label>
            <Input
              id={`proceeds-${sale.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={proceeds}
              onChange={(e) => setProceeds(e.target.value)}
              className="bg-[#1A1A1A] border-[#333]"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 w-full sm:w-auto"
            disabled={busy || !(parseFloat(proceeds) > 0)}
            onClick={() =>
              void patch({
                status: "cash_on_the_way",
                proceedsUsd: parseFloat(proceeds) || 0,
              })
            }
          >
            Save
          </Button>
        </div>
      )}

      {sale.status === "cash_on_the_way" && (
        <Button
          type="button"
          size="sm"
          className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 self-start"
          disabled={busy}
          onClick={() => void linkDeposit()}
        >
          Link the deposit
        </Button>
      )}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,28rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this refill?</AlertDialogTitle>
            <AlertDialogDescription>
              We&apos;ll take it out of your total. You can start another refill if the cash still
              hasn&apos;t landed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333]">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500/90 text-[#0D0D0D] hover:bg-amber-500"
              onClick={() => {
                setCancelOpen(false)
                void patch({ status: "cancelled" })
              }}
            >
              Cancel refill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <p className="text-xs text-amber-400/95" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function TotalsEditor({
  plan,
  watchCount,
  onSave,
  onDone,
}: {
  plan: RunwayPlanResponse
  watchCount: number
  onSave: (patch: Partial<RunwayPlanResponse>) => Promise<boolean>
  onDone: () => void
}) {
  const showBitcoin = watchCount <= 0 || plan.bitcoinOverrideSats != null
  const [cash, setCash] = useState(plan.cashOverrideUsd != null ? String(plan.cashOverrideUsd) : "")
  const [btc, setBtc] = useState(
    plan.bitcoinOverrideSats != null ? String(plan.bitcoinOverrideSats / SATS_PER_BTC) : "",
  )

  const [formError, setFormError] = useState<string | null>(null)

  const save = () => {
    const parsed = parseHoldingsOverrides(cash, btc)
    if (!parsed.ok) {
      setFormError(parsed.error)
      return
    }
    setFormError(null)
    void onSave({
      cashOverrideUsd: parsed.cashOverrideUsd,
      bitcoinOverrideSats: parsed.bitcoinOverrideSats,
    })
    onDone()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Type a total to override what we calculate — leave blank to use your budget and wallet.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totals-cash">Cash total (USD)</Label>
          <Input
            id="totals-cash"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={cash}
            placeholder="Use my budget"
            onChange={(e) => setCash(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
        {showBitcoin && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="totals-btc">Bitcoin total (BTC)</Label>
            <Input
              id="totals-btc"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.00000001"
              value={btc}
              placeholder="Use my wallet"
              onChange={(e) => setBtc(e.target.value)}
              className="bg-[#1A1A1A] border-[#333]"
            />
          </div>
        )}
      </div>
      {formError && (
        <p className="text-xs text-amber-400/95" role="alert">
          {formError}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
          onClick={save}
        >
          Save totals
        </Button>
      </div>
    </div>
  )
}

function BillList({
  lines,
  onChange,
}: {
  lines: PlannedLine[]
  onChange: (lines: PlannedLine[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [amount, setAmount] = useState("")

  const add = () => {
    const monthly = parseFloat(amount)
    if (!label.trim() || !Number.isFinite(monthly) || monthly <= 0) return
    onChange([
      ...lines,
      {
        id: newId(),
        group: "other",
        label: label.trim(),
        monthlyUsd: Math.round(monthly * 100) / 100,
        mode: "add",
      },
    ])
    setLabel("")
    setAmount("")
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-foreground">Bills after you step back</span>
      {lines.length === 0 && (
        <p className="text-xs text-muted-foreground">None yet. Add one if a new cost starts later.</p>
      )}
      {lines.map((line) => (
        <div
          key={line.id}
          className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 min-w-0"
        >
          <span className="text-sm text-foreground min-w-0 break-words">{line.label}</span>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-sm tabular-nums text-foreground">{formatUsd(line.monthlyUsd)}/mo</span>
            <button
              type="button"
              onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
              className="p-1 text-muted-foreground hover:text-amber-400 shrink-0"
              aria-label={`Remove ${line.label}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      ))}
      {!open ? (
        <Button type="button" variant="outline" size="sm" className="border-[#333] self-start" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
          Add a bill
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-label">What is it?</Label>
          <Input
            id="bill-label"
            value={label}
            placeholder="Health insurance"
            onChange={(e) => setLabel(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
          <Label htmlFor="bill-amount">Each month</Label>
          <Input
            id="bill-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
              onClick={add}
              disabled={!label.trim() || !(parseFloat(amount) > 0)}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScenarioAdder({ onAdd }: { onAdd: (sc: RunwayScenario) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [monthly, setMonthly] = useState("")
  const [oneTime, setOneTime] = useState("")

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-[#333] self-start"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
        Add a what-if
      </Button>
    )
  }

  const add = () => {
    if (!label.trim()) return
    const monthlyNum = parseFloat(monthly) || 0
    const oneTimeNum = parseFloat(oneTime) || 0
    onAdd({
      id: newId(),
      label: label.trim(),
      monthlyDeltaUsd: monthlyNum,
      oneTimeUsd: oneTimeNum,
      enabled: true,
    })
    setLabel("")
    setMonthly("")
    setOneTime("")
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="scenario-label">What changes?</Label>
        <Input
          id="scenario-label"
          value={label}
          placeholder="e.g. Pay off the car"
          onChange={(e) => setLabel(e.target.value)}
          className="bg-[#1A1A1A] border-[#333]"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="scenario-monthly">Monthly change (USD)</Label>
          <Input
            id="scenario-monthly"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={monthly}
            placeholder="-300"
            onChange={(e) => setMonthly(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="scenario-onetime">One-time amount (USD)</Label>
          <Input
            id="scenario-onetime"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={oneTime}
            placeholder="+5000"
            onChange={(e) => setOneTime(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
          onClick={add}
          disabled={!label.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  )
}
