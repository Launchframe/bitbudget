"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"
import { OFFERED_PLANNED_LINE_LABELS, type PlannedLine } from "@/lib/runway-need"
import type {
  BorrowStance,
  BtcSharePreference,
  DipResponse,
} from "@/lib/runway-risk"
import {
  isRunwayConfigured,
  RUNWAY_JUST_SETUP_KEY,
  type RunwayPlanResponse,
} from "@/lib/runway-ui"
import { formatUsd } from "@/lib/data"
import { Briefcase } from "lucide-react"

const DRAFT_KEY = "bitbudget-runway-setup-draft"
const TOTAL_STEPS = 3
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SATS_PER_BTC = 100_000_000

const STEP_TITLES = [
  "When do you step back?",
  "Your comfort with risk",
  "Income and living costs",
]
const STEP_SUBTITLES = [
  "Tell us where you are so we can size your runway.",
  "Three quick questions. The middle answers are already selected.",
  "What you'll bring in, and what life costs each month.",
]

interface RunwaySetupDraft {
  v: 1
  step: number
  phase: "buildup" | "runway"
  quitDate: string
  horizonMonths: number
  dipResponse: DipResponse
  btcSharePreference: BtcSharePreference
  borrowStance: BorrowStance
  runwayIncomeUsd: string
  livingBaselineUsd: string
  /** label → monthly amount string. */
  plannedAmounts: Record<string, string>
  cashHoldings?: string
  btcHoldings?: string
}

function isDraft(v: unknown): v is RunwaySetupDraft {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as RunwaySetupDraft).v === 1 &&
    typeof (v as RunwaySetupDraft).phase === "string"
  )
}

interface ChoiceOption<T extends string> {
  value: T
  title: string
  hint?: string
}

function ChoiceCards<T extends string>({
  legend,
  value,
  onChange,
  options,
  columns = 1,
}: {
  legend: string
  value: T
  onChange: (v: T) => void
  options: ChoiceOption<T>[]
  columns?: 1 | 3
}) {
  return (
    <div
      role="radiogroup"
      aria-label={legend}
      className={columns === 3 ? "grid grid-cols-1 sm:grid-cols-3 gap-2" : "flex flex-col gap-2"}
    >
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`text-left rounded-xl border p-3 transition-colors min-w-0 ${
              selected
                ? "border-[#F7931A] bg-[#F7931A]/10"
                : "border-[#333] bg-[#1A1A1A]/50 hover:border-[#555]"
            }`}
          >
            <span className={`block text-sm font-medium ${selected ? "text-foreground" : "text-foreground/90"}`}>
              {opt.title}
            </span>
            {opt.hint && (
              <span className="block text-xs text-muted-foreground mt-0.5">{opt.hint}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function MoneyField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">$</span>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const n = parseFloat(e.target.value)
            onChange(Number.isFinite(n) && n >= 0 ? String(n) : "")
          }}
          className="bg-[#1A1A1A] border-[#333]"
        />
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function RunwaySetupDialog({
  open,
  onOpenChange,
  plan,
  livingPlaceholderUsd,
  suggestedStressPercent,
  promptHoldings = false,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: RunwayPlanResponse | null
  /** Recent-spend monthly average used to prefill living costs. */
  livingPlaceholderUsd: number
  /**
   * Default stress percent from historical drawdowns. Seeds a brand-new plan's
   * stress; an already-configured plan keeps its (possibly user-edited) stress.
   */
  suggestedStressPercent?: number
  /** Show optional cash/bitcoin fields when the budget and wallet are still empty. */
  promptHoldings?: boolean
  onSaved: (plan: RunwayPlanResponse) => void
}) {
  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<"buildup" | "runway">("buildup")
  const [quitDate, setQuitDate] = useState("")
  const [horizonMonths, setHorizonMonths] = useState(24)
  const [dipResponse, setDipResponse] = useState<DipResponse>("cut")
  const [btcSharePreference, setBtcSharePreference] = useState<BtcSharePreference>("half")
  const [borrowStance, setBorrowStance] = useState<BorrowStance>("deep_drop")
  const [runwayIncomeUsd, setRunwayIncomeUsd] = useState("0")
  const [livingBaselineUsd, setLivingBaselineUsd] = useState("")
  const [plannedAmounts, setPlannedAmounts] = useState<Record<string, string>>({})
  const [cashHoldings, setCashHoldings] = useState("")
  const [btcHoldings, setBtcHoldings] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

  const hydratedRef = useRef(false)
  const clearOpenRef = useRef(false)
  clearOpenRef.current = clearOpen

  const livingFallback =
    livingPlaceholderUsd > 0 ? String(Math.round(livingPlaceholderUsd)) : ""

  // Hydrate from draft, then plan, then placeholder (draft wins).
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false
      return
    }
    if (hydratedRef.current) return
    hydratedRef.current = true

    const draft = loadDraft(DRAFT_KEY, isDraft)
    if (draft) {
      setStep(Math.min(draft.step, TOTAL_STEPS - 1))
      setPhase(draft.phase)
      setQuitDate(draft.quitDate)
      setHorizonMonths(draft.horizonMonths)
      setDipResponse(draft.dipResponse)
      setBtcSharePreference(draft.btcSharePreference)
      setBorrowStance(draft.borrowStance)
      setRunwayIncomeUsd(draft.runwayIncomeUsd)
      setLivingBaselineUsd(draft.livingBaselineUsd)
      setPlannedAmounts(draft.plannedAmounts ?? {})
      setCashHoldings(draft.cashHoldings ?? "")
      setBtcHoldings(draft.btcHoldings ?? "")
      return
    }
    // Prefill from an existing plan (editing) or sensible defaults.
    setStep(0)
    if (plan) {
      setPhase(plan.phase)
      setQuitDate(plan.quitDate ?? "")
      setHorizonMonths(plan.horizonMonths)
      setDipResponse(plan.dipResponse)
      setBtcSharePreference(plan.btcSharePreference)
      setBorrowStance(plan.borrowStance)
      setRunwayIncomeUsd(String(plan.runwayIncomeUsd ?? 0))
      setLivingBaselineUsd(
        plan.livingBaselineOverrideUsd != null
          ? String(plan.livingBaselineOverrideUsd)
          : livingFallback,
      )
      const amounts: Record<string, string> = {}
      for (const line of plan.plannedLines) {
        if (line.monthlyUsd > 0) amounts[line.label] = String(line.monthlyUsd)
      }
      setPlannedAmounts(amounts)
    } else {
      setLivingBaselineUsd(livingFallback)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Persist draft on change (debounced) while open.
  useEffect(() => {
    if (!open || !hydratedRef.current) return
    saveDraft<RunwaySetupDraft>(DRAFT_KEY, {
      v: 1,
      step,
      phase,
      quitDate,
      horizonMonths,
      dipResponse,
      btcSharePreference,
      borrowStance,
      runwayIncomeUsd,
      livingBaselineUsd,
      plannedAmounts,
      cashHoldings,
      btcHoldings,
    })
  }, [
    open,
    step,
    phase,
    quitDate,
    horizonMonths,
    dipResponse,
    btcSharePreference,
    borrowStance,
    runwayIncomeUsd,
    livingBaselineUsd,
    plannedAmounts,
    cashHoldings,
    btcHoldings,
  ])

  const resetState = useCallback(() => {
    setStep(0)
    setPhase("buildup")
    setQuitDate("")
    setHorizonMonths(24)
    setDipResponse("cut")
    setBtcSharePreference("half")
    setBorrowStance("deep_drop")
    setRunwayIncomeUsd("0")
    setLivingBaselineUsd(livingFallback)
    setPlannedAmounts({})
    setCashHoldings("")
    setBtcHoldings("")
    setError(null)
  }, [livingFallback])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Dismissing the nested Clear-All confirm must not close the wizard.
      if (!next && clearOpenRef.current) return
      onOpenChange(next)
    },
    [onOpenChange],
  )

  const stepValid = useMemo(() => {
    if (step === 0 && phase === "buildup") {
      if (!DATE_RE.test(quitDate)) return false
      if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 600) {
        return false
      }
    }
    return true
  }, [step, phase, quitDate, horizonMonths])

  const isLast = step === TOTAL_STEPS - 1

  const goNext = useCallback(() => {
    setError(null)
    if (!stepValid) {
      if (step === 0 && !DATE_RE.test(quitDate)) {
        setError("Pick the date you plan to step back.")
      } else {
        setError("That horizon looks off — use 1 to 600 months.")
      }
      return
    }
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))
  }, [stepValid, step, quitDate])

  const goBack = useCallback(() => {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }, [])

  const buildPlannedLines = useCallback((): PlannedLine[] => {
    const lines: PlannedLine[] = []
    for (const offered of OFFERED_PLANNED_LINE_LABELS) {
      const raw = plannedAmounts[offered.label]
      const amount = parseFloat(raw ?? "")
      if (Number.isFinite(amount) && amount > 0) {
        lines.push({
          id: `offered-${offered.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          group: offered.group,
          label: offered.label,
          monthlyUsd: Math.round(amount * 100) / 100,
          mode: "add",
        })
      }
    }
    // Preserve any custom (non-offered) planned lines already on the plan.
    const offeredLabels = new Set(OFFERED_PLANNED_LINE_LABELS.map((o) => o.label))
    for (const line of plan?.plannedLines ?? []) {
      if (!offeredLabels.has(line.label)) lines.push(line)
    }
    return lines
  }, [plannedAmounts, plan])

  const finish = useCallback(async () => {
    if (!stepValid) return
    setSaving(true)
    setError(null)
    const income = parseFloat(runwayIncomeUsd)
    const living = parseFloat(livingBaselineUsd)
    const firstSetup = !isRunwayConfigured(plan)
    // Seed stress from historical drawdowns for a brand-new plan only. Once the
    // plan is configured, keep its saved (possibly user-edited) stress.
    const seedStress =
      firstSetup &&
      typeof suggestedStressPercent === "number" &&
      Number.isFinite(suggestedStressPercent)
        ? { stressPercent: suggestedStressPercent }
        : {}
    const cashNum = parseFloat(cashHoldings)
    const btcNum = parseFloat(btcHoldings)
    const holdingsPatch =
      promptHoldings
        ? {
            ...(cashHoldings.trim() !== "" && Number.isFinite(cashNum) && cashNum >= 0
              ? { cashOverrideUsd: Math.round(cashNum * 100) / 100 }
              : {}),
            ...(btcHoldings.trim() !== "" && Number.isFinite(btcNum) && btcNum >= 0
              ? { bitcoinOverrideSats: Math.round(btcNum * SATS_PER_BTC) }
              : {}),
          }
        : {}
    const body = {
      ...(plan ?? {}),
      phase,
      quitDate: phase === "buildup" ? quitDate : null,
      horizonMonths,
      runwayIncomeUsd: Number.isFinite(income) && income >= 0 ? income : 0,
      livingBaselineOverrideUsd: Number.isFinite(living) && living >= 0 ? living : 0,
      dipResponse,
      btcSharePreference,
      borrowStance,
      plannedLines: buildPlannedLines(),
      ...holdingsPatch,
      ...seedStress,
    }
    // createdAt/updatedAt are server-managed; the parser ignores them.
    delete (body as Record<string, unknown>).createdAt
    delete (body as Record<string, unknown>).updatedAt

    try {
      const res = await fetch("/api/runway/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save your runway.")
        return
      }
      clearDraft(DRAFT_KEY)
      if (firstSetup && typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(RUNWAY_JUST_SETUP_KEY, "1")
      }
      onSaved(data as RunwayPlanResponse)
      onOpenChange(false)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSaving(false)
    }
  }, [
    stepValid,
    plan,
    phase,
    quitDate,
    horizonMonths,
    runwayIncomeUsd,
    livingBaselineUsd,
    dipResponse,
    btcSharePreference,
    borrowStance,
    buildPlannedLines,
    suggestedStressPercent,
    promptHoldings,
    cashHoldings,
    btcHoldings,
    onSaved,
    onOpenChange,
  ])

  const primaryDisabled = saving || !stepValid

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,32rem)] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden"
        onKeyDown={(e) =>
          handleDialogEnterToPrimary(e, {
            disabled: primaryDisabled,
            onPrimary: () => (isLast ? void finish() : goNext()),
          })
        }
      >
        {/* Stable header: title, subtitle, progress */}
        <div className="px-5 pt-5 pb-3 border-b border-[#1F1F1F]">
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-[#F7931A]/10">
                <Briefcase className="h-4 w-4 text-[#F7931A]" aria-hidden />
              </span>
              {STEP_TITLES[step]}
            </DialogTitle>
            <DialogDescription>{STEP_SUBTITLES[step]}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1.5 mt-3" aria-hidden>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-[#F7931A]" : "bg-[#1F1F1F]"
                }`}
              />
            ))}
          </div>
          <span className="sr-only" aria-live="polite">
            Step {step + 1} of {TOTAL_STEPS}
          </span>
        </div>

        {/* Scrollable body with reserved height to avoid jump */}
        <div className="px-5 py-4 overflow-y-auto min-h-[20rem] flex-1">
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <ChoiceCards
                legend="Where are you now?"
                value={phase}
                onChange={setPhase}
                options={[
                  {
                    value: "buildup",
                    title: "I'm still earning",
                    hint: "I have a paycheck and I'm building toward stepping back.",
                  },
                  {
                    value: "runway",
                    title: "I'm living off my savings",
                    hint: "I've already stepped back — no regular paycheck.",
                  },
                ]}
              />
              {phase === "buildup" && (
                <div className="flex flex-col gap-4 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="runway-quit-date">When do you plan to step back?</Label>
                    <Input
                      id="runway-quit-date"
                      type="date"
                      value={quitDate}
                      onChange={(e) => setQuitDate(e.target.value)}
                      className="bg-[#1A1A1A] border-[#333]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="runway-horizon">How many months should your runway cover?</Label>
                    <Input
                      id="runway-horizon"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={600}
                      value={horizonMonths}
                      onChange={(e) =>
                        setHorizonMonths(Math.max(1, Math.round(Number(e.target.value) || 0)))
                      }
                      className="bg-[#1A1A1A] border-[#333] w-32"
                    />
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {[12, 24, 36, 60].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setHorizonMonths(m)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            horizonMonths === m
                              ? "border-[#F7931A] text-[#F7931A] bg-[#F7931A]/10"
                              : "border-[#333] text-muted-foreground hover:border-[#555]"
                          }`}
                        >
                          {m === 12 ? "1 yr" : m === 60 ? "5 yrs" : `${m / 12} yrs`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-5">
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-foreground mb-1">
                  If bitcoin fell by half and stayed down for a year, what would you do?
                </legend>
                <ChoiceCards
                  legend="Response to a long bitcoin dip"
                  value={dipResponse}
                  onChange={setDipResponse}
                  columns={3}
                  options={[
                    { value: "wait", title: "Wait it out", hint: "Hold steady" },
                    { value: "cut", title: "Trim spending", hint: "Ride it out leaner" },
                    { value: "sell", title: "Sell some", hint: "Raise cash" },
                  ]}
                />
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-foreground mb-1">
                  How much of your savings do you want held in bitcoin?
                </legend>
                <ChoiceCards
                  legend="Bitcoin share of savings"
                  value={btcSharePreference}
                  onChange={setBtcSharePreference}
                  columns={3}
                  options={[
                    { value: "little", title: "A little", hint: "~20%" },
                    { value: "half", title: "About half", hint: "~50%" },
                    { value: "most", title: "Most of it", hint: "~80%" },
                  ]}
                />
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-foreground mb-1">
                  Would you ever borrow against your bitcoin instead of selling it?
                </legend>
                <ChoiceCards
                  legend="Borrowing against bitcoin"
                  value={borrowStance}
                  onChange={setBorrowStance}
                  columns={3}
                  options={[
                    { value: "never", title: "Never", hint: "I'd rather sell" },
                    { value: "deep_drop", title: "Only in a deep drop", hint: "As a backstop" },
                    { value: "ok", title: "Sure, any time", hint: "Keep my bitcoin" },
                  ]}
                />
              </fieldset>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <MoneyField
                id="runway-income"
                label="Money you expect each month after you leave"
                hint="Part-time work, rentals, a pension — leave at 0 if none."
                value={runwayIncomeUsd}
                onChange={setRunwayIncomeUsd}
                placeholder="0"
              />
              <MoneyField
                id="runway-living"
                label="Your monthly living costs"
                hint={
                  livingPlaceholderUsd > 0
                    ? `Prefilled from your recent spending (${formatUsd(livingPlaceholderUsd)}/mo). Adjust if it's off.`
                    : "What a normal month costs you. You can refine this later."
                }
                value={livingBaselineUsd}
                onChange={setLivingBaselineUsd}
                placeholder={livingFallback || "0"}
              />
              {promptHoldings && (
                <div className="flex flex-col gap-3 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    Optional — what you already have. Leave blank and you can add it on the next screen.
                  </p>
                  <MoneyField
                    id="runway-cash-holdings"
                    label="Cash you have today"
                    value={cashHoldings}
                    onChange={setCashHoldings}
                    placeholder="0"
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="runway-btc-holdings">Bitcoin you have today</Label>
                    <Input
                      id="runway-btc-holdings"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.00000001"
                      value={btcHoldings}
                      placeholder="0"
                      onChange={(e) => setBtcHoldings(e.target.value)}
                      className="bg-[#1A1A1A] border-[#333]"
                    />
                    <span className="text-xs text-muted-foreground">In bitcoin, not dollars.</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-amber-400/95 pt-3" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Stable footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[#1F1F1F]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setClearOpen(true)}
          >
            Clear all
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button type="button" variant="outline" onClick={goBack} disabled={saving}>
                Back
              </Button>
            )}
            <Button
              type="button"
              className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
              onClick={() => (isLast ? void finish() : goNext())}
              disabled={primaryDisabled}
            >
              {isLast ? (saving ? "Saving…" : "See my runway") : "Next"}
            </Button>
          </div>
        </div>

        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent
            className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground"
            onEscapeKeyDown={(e) => e.stopPropagation()}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Clear your answers?</AlertDialogTitle>
              <AlertDialogDescription>
                This discards everything you&apos;ve entered in this setup and starts fresh. Your
                saved runway (if any) is not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-[#333]">Keep editing</AlertDialogCancel>
              <AlertDialogAction
                className="bg-amber-500/90 text-[#0D0D0D] hover:bg-amber-500"
                onClick={() => {
                  clearDraft(DRAFT_KEY)
                  resetState()
                  setClearOpen(false)
                }}
              >
                Clear all
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
