"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { getCurrentMonthKey, formatUsd } from "@/lib/data"
import { useRunway, type RunwayLoan, type RunwayPendingSale } from "@/lib/use-runway"
import { RunwaySetupDialog } from "@/components/runway-setup-dialog"
import { RunwayLoanDialog } from "@/components/runway-loan-dialog"
import { RunwayRefillDialog } from "@/components/runway-refill-dialog"
import { refillStatus } from "@/lib/runway-refill"
import {
  borrowingAllowed,
  buildPlanPutBody,
  checkupMonthName,
  formatLiquidationRoomPct,
  formatSharePct,
  gapSummaryLine,
  isCheckupReady,
  isRunwayConfigured,
  satsToUsd,
  type RunwayPlanResponse,
} from "@/lib/runway-ui"
import type { RunwayScenario } from "@/lib/runway-need"
import {
  computeMonthsLeftImpact,
  formatMonthsLeft,
} from "@/lib/runway-expense-impact"
import type { LoanEvaluation } from "@/lib/loan-health"
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
  Landmark,
  Pencil,
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

/** A gap figure with a reserved band so toggling scenarios doesn't resize the card. */
function GapStat({
  icon,
  label,
  gapUsd,
  onTrackCopy,
}: {
  icon: React.ReactNode
  label: string
  gapUsd: number
  onTrackCopy: string
}) {
  const infinite = !Number.isFinite(gapUsd)
  const short = infinite || gapUsd > 0.5
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="mt-2 min-h-[2.75rem] flex flex-col justify-center">
        {short ? (
          <>
            <span className="text-xl md:text-2xl font-bold text-amber-400 tabular-nums">
              {infinite ? "—" : formatUsd(gapUsd)}
            </span>
            <span className="text-xs text-muted-foreground">still to go</span>
          </>
        ) : (
          <span className="text-sm font-medium text-[#22C55E]">{onTrackCopy}</span>
        )}
      </div>
    </div>
  )
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col">
          <span className="text-muted-foreground">Bill due</span>
          <span className="text-foreground tabular-nums">
            {evaluation ? formatUsd(evaluation.amountDueTodayUsd) : formatUsd(loan.principalUsd)}
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
    btcPriceOrNull,
    loans,
    loansEval,
    reloadLoans,
    pendingSales,
    reloadSales,
    nextPaycheckUsd,
    btcPriceUsd,
    suggestedStressPercent,
    compute,
  } = useRunway({ withLoans: true })

  const [setupOpen, setSetupOpen] = useState(false)
  const [applyScenarios, setApplyScenarios] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [loanPrefill, setLoanPrefill] = useState<
    { principalUsd?: number; collateralBtc?: number } | null
  >(null)
  const [refillOpen, setRefillOpen] = useState(false)
  const [editTotals, setEditTotals] = useState(false)
  const [scenariosOpen, setScenariosOpen] = useState(false)

  const monthKey = getCurrentMonthKey()
  const configured = isRunwayConfigured(plan)
  const checkupReady = isCheckupReady(plan, monthKey)
  const [showCheckup, setShowCheckup] = useState(false)

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
    if (!configured || !checkupReady || markedRef.current || !planRef.current) return
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
  }, [configured, checkupReady, monthKey, setPlan])

  const scenarioMode = applyScenarios ? "enabled" : "none"
  const comp = useMemo(() => compute(scenarioMode), [compute, scenarioMode])

  // The transient "See this on your plan" what-if is a preview only — never
  // persisted. Clear it when the user navigates away from Runway.
  useEffect(() => {
    return () => setRunwayWhatIf(null)
  }, [setRunwayWhatIf])

  const savePatch = useCallback(
    async (patch: Partial<RunwayPlanResponse>) => {
      const current = planRef.current
      if (!current) return
      const optimistic = { ...current, ...patch }
      setPlan(optimistic)
      try {
        const res = await fetch("/api/runway/plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPlanPutBody(current, patch)),
        })
        if (res.ok) {
          const saved = (await res.json()) as RunwayPlanResponse
          setPlan(saved)
        }
      } catch {
        /* optimistic update already applied; next reload reconciles */
      }
    },
    [setPlan],
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
          Turn on bitcoin features in Settings to plan how long your money lasts.
        </p>
        <Button variant="outline" className="border-[#333]" onClick={() => navigateTo("settings")}>
          Open Settings
        </Button>
      </div>
    )
  }

  if (loading) {
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
          onSaved={setPlan}
        />
      </div>
    )
  }

  const need = comp?.need
  const gap = comp?.gap
  const priceKnown = btcPriceOrNull != null && btcPriceOrNull > 0
  const scenarios = plan.scenarios

  const bitcoinKnownUsd = need ? satsToUsd(need.spendableSats, btcPriceOrNull ?? 0) : 0
  const monthsUntil = comp?.monthsUntilQuit ?? 0

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
    <div className="flex flex-col gap-4 md:gap-6 min-w-0 w-full max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 min-w-0">
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
        <Button
          variant="outline"
          size="sm"
          className="border-[#333] shrink-0"
          onClick={() => setSetupOpen(true)}
        >
          <Settings2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          Adjust
        </Button>
      </div>

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

      {/* Checkup banner */}
      {(showCheckup || checkupReady) && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#F7931A]/30 bg-[#F7931A]/5 p-4">
          <CalendarCheck className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{checkupMonthName(monthKey)} check-in</p>
            <p className="text-xs text-muted-foreground">
              Here&apos;s where your runway stands this month. Adjust anything that&apos;s changed.
            </p>
          </div>
        </div>
      )}

      {/* Gap hero */}
      {need && gap && (
        <div className="flex flex-col gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
          <p className="text-base md:text-lg font-semibold text-foreground">
            {gapSummaryLine(gap.flat.cashGapUsd, gap.flat.bitcoinGapUsd)}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <GapStat
              icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
              label="Cash gap"
              gapUsd={gap.flat.cashGapUsd}
              onTrackCopy="Cash floor covered"
            />
            <GapStat
              icon={<Bitcoin className="h-3.5 w-3.5" aria-hidden />}
              label="Bitcoin gap"
              gapUsd={gap.flat.bitcoinGapUsd}
              onTrackCopy="Bitcoin target met"
            />
          </div>
          {!priceKnown && (
            <p className="text-xs text-muted-foreground">
              Bitcoin figures need a live price — they&apos;ll fill in once prices load.
            </p>
          )}
        </div>
      )}

      {/* Mix + cash floor */}
      {need && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="flex flex-col gap-4 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Your bitcoin mix</span>
            <MixBar label="Target" share={need.targetBtcShare} color="#F7931A" />
            <MixBar label="Right now" share={need.actualBtcShare} color="#3B82F6" />
            <p className="text-xs text-muted-foreground">
              {need.actualBtcShare > need.targetBtcShare + 0.03
                ? "You're leaning more on bitcoin than your target — a bigger cash cushion helps."
                : need.actualBtcShare < need.targetBtcShare - 0.03
                  ? "You're holding less bitcoin than your target right now."
                  : "You're close to your target mix."}
            </p>
          </div>
          <div className="flex flex-col gap-2 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Cash floor</span>
            <span className="text-2xl md:text-3xl font-bold text-foreground tabular-nums">
              {formatUsd(need.cashFloorUsedUsd)}
            </span>
            <p className="text-xs text-muted-foreground">
              About {need.cashFloorMonths} month{need.cashFloorMonths === 1 ? "" : "s"} of spending
              kept in cash before you&apos;d lean on bitcoin.
            </p>
            {/* Reserved band so the floor card height is stable whether or not
                there's a shortfall or an upcoming breach to mention. */}
            <div className="min-h-[2.75rem] flex flex-col justify-center">
              {refill && refill.underFloor ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-amber-400">
                    Your cash is {formatUsd(refill.shortfallUsd)} under this floor right now.
                  </p>
                  <Button
                    size="sm"
                    className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 self-start"
                    onClick={() => setRefillOpen(true)}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    Refill the floor
                  </Button>
                </div>
              ) : refill && refill.monthsUntilBreach != null ? (
                <p className="text-xs text-muted-foreground">
                  At your current pace, cash reaches this floor in about{" "}
                  {Math.max(1, Math.round(refill.monthsUntilBreach))} month
                  {Math.round(refill.monthsUntilBreach) === 1 ? "" : "s"}.
                </p>
              ) : (
                <p className="text-xs text-[#22C55E]">Your cash is above the floor.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Totals (what you have) */}
      {need && (
        <div className="flex flex-col gap-3 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">What you have today</span>
            <button
              type="button"
              onClick={() => setEditTotals((v) => !v)}
              className="text-xs text-[#F7931A] hover:underline flex items-center gap-1"
            >
              <Pencil className="h-3 w-3" aria-hidden />
              {editTotals ? "Done" : "Edit totals"}
            </button>
          </div>
          {!editTotals ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" aria-hidden /> Cash
                </span>
                <span className="block text-lg font-semibold text-foreground tabular-nums mt-1">
                  {formatUsd(need.cashUsd)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {plan.cashOverrideUsd != null ? "Typed total" : "From your savings & envelopes"}
                </span>
              </div>
              <div className="rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Bitcoin className="h-3.5 w-3.5" aria-hidden /> Bitcoin
                </span>
                <span className="block text-lg font-semibold text-foreground tabular-nums mt-1">
                  {priceKnown ? formatUsd(bitcoinKnownUsd) : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {plan.bitcoinOverrideSats != null
                    ? "Typed total"
                    : "Type how much bitcoin you hold"}
                </span>
              </div>
            </div>
          ) : (
            <TotalsEditor plan={plan} onSave={savePatch} onDone={() => setEditTotals(false)} />
          )}
        </div>
      )}

      {/* What-if scenarios */}
      {need && gap && (
        <Collapsible open={scenariosOpen} onOpenChange={setScenariosOpen}>
          <div className="bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F] overflow-hidden">
            <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 p-4 md:p-5 text-left">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-foreground">What if…</span>
                <p className="text-xs text-muted-foreground">
                  Try changes like a paid-off bill or a one-time sale to see how they move your gap.
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${scenariosOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 md:px-5 pb-5 flex flex-col gap-3">
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
                  <div key={sc.id} className="flex items-center gap-3 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 min-w-0">
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
                        {closedUsd > 0.5 && <> · closes {formatUsd(closedUsd)} of your gap</>}
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
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Borrow block */}
      {need && borrowingAllowed(plan) && (
        <div className="flex flex-col gap-3 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Landmark className="h-4 w-4 text-[#F7931A] shrink-0" aria-hidden />
              <span className="text-sm font-semibold text-foreground">Borrowing against bitcoin</span>
            </div>
            <Button variant="outline" size="sm" className="border-[#333] shrink-0" onClick={() => setLoanOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
              Add loan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            You could borrow up to about {formatUsd(need.borrowCapacityUsd)} against your bitcoin
            instead of selling it{priceKnown ? "" : " (needs a live price)"}.
          </p>
          {loans.filter((l) => l.status === "open").length > 0 ? (
            <div className="flex flex-col gap-2">
              {loans
                .filter((l) => l.status === "open")
                .map((loan) => (
                  <LoanRow
                    key={loan.id}
                    loan={loan}
                    evaluation={loansEval.find((e) => e.id === loan.id)}
                    priceKnown={priceKnown}
                    onDelete={() => {
                      void fetch(`/api/runway/loans?id=${encodeURIComponent(loan.id)}`, {
                        method: "DELETE",
                      }).then(() => reloadLoans())
                    }}
                  />
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No loans tracked yet.</p>
          )}
        </div>
      )}

      {/* Sales in progress */}
      {openSales.length > 0 && (
        <PendingSalesSection
          sales={openSales}
          onChanged={reloadSales}
          onLinked={(sale) => {
            // Permanently move sold sats out of the typed bitcoin total and
            // credit cash with proceeds so linking doesn't snap holdings back.
            const current = planRef.current
            if (!current) return
            const nextBtc =
              current.bitcoinOverrideSats != null
                ? Math.max(0, current.bitcoinOverrideSats - sale.sats)
                : current.bitcoinOverrideSats
            const proceeds = sale.proceedsUsd ?? 0
            const nextCash =
              proceeds > 0
                ? (current.cashOverrideUsd ?? envelopeCashUsd) + proceeds
                : current.cashOverrideUsd
            void savePatch({
              bitcoinOverrideSats: nextBtc,
              cashOverrideUsd: nextCash,
            })
          }}
        />
      )}

      <RunwaySetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        plan={plan}
        livingPlaceholderUsd={livingPlaceholder}
        suggestedStressPercent={suggestedStressPercent}
        onSaved={setPlan}
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
    </div>
  )
}

function PendingSalesSection({
  sales,
  onChanged,
  onLinked,
}: {
  sales: RunwayPendingSale[]
  onChanged: () => void
  onLinked: (sale: RunwayPendingSale) => void
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
            onLinked={onLinked}
          />
        ))}
      </div>
    </div>
  )
}

function PendingSaleRow({
  sale,
  onChanged,
  onLinked,
}: {
  sale: RunwayPendingSale
  onChanged: () => void
  onLinked: (sale: RunwayPendingSale) => void
}) {
  const [recording, setRecording] = useState(false)
  const [proceeds, setProceeds] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        if (body.status === "linked") {
          onLinked({
            ...sale,
            status: "linked",
            proceedsUsd:
              typeof body.proceedsUsd === "number" ? body.proceedsUsd : sale.proceedsUsd,
          })
        }
        onChanged()
      } catch {
        setError("Network error — try again.")
      } finally {
        setBusy(false)
      }
    },
    [sale, onChanged, onLinked],
  )

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
          onClick={() => void patch({ status: "cancelled" })}
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
          onClick={() => void patch({ status: "linked" })}
        >
          Link the deposit
        </Button>
      )}

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
  onSave,
  onDone,
}: {
  plan: RunwayPlanResponse
  onSave: (patch: Partial<RunwayPlanResponse>) => Promise<void>
  onDone: () => void
}) {
  const [cash, setCash] = useState(plan.cashOverrideUsd != null ? String(plan.cashOverrideUsd) : "")
  const [btc, setBtc] = useState(
    plan.bitcoinOverrideSats != null ? String(plan.bitcoinOverrideSats / SATS_PER_BTC) : "",
  )

  const save = () => {
    const cashNum = parseFloat(cash)
    const btcNum = parseFloat(btc)
    void onSave({
      cashOverrideUsd: cash.trim() === "" || !Number.isFinite(cashNum) ? null : cashNum,
      bitcoinOverrideSats:
        btc.trim() === "" || !Number.isFinite(btcNum) ? null : Math.round(btcNum * SATS_PER_BTC),
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totals-btc">Bitcoin total (BTC)</Label>
          <Input
            id="totals-btc"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.00000001"
            value={btc}
            placeholder="0"
            onChange={(e) => setBtc(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
      </div>
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
            placeholder="-300 frees up cash"
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
            placeholder="+5000 from a sale"
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
