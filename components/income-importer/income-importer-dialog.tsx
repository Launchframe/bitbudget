"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { TrendingUp } from "lucide-react"
import { useApp } from "@/lib/app-context"
import {
  EXISTING_INCOME_SOURCES,
  entriesNeedMonthlyIncome,
  parseIncomePeriodKey,
  periodBoundsForExistingIncome,
} from "@/lib/income-import"
import { suggestedImportIncome } from "@/lib/income-import-defaults"
import { findTransactionHistoryStart } from "@/lib/income-import-tx0"
import { summarizeImportEntries } from "@/lib/income-import-calendar"
import { clearDraft, loadDraft, saveDraft, saveDraftImmediate } from "@/lib/draft-storage"
import {
  Dialog,
  DialogContent,
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
import { IncomePaintBar } from "@/components/income-importer/income-paint-bar"
import { IncomeCalendar, type ImportCalendarMode, type StagedImportEntry } from "@/components/income-importer/income-calendar"
import { IncomeImporterLegend } from "@/components/income-importer/legend"
import { IncomeCellEditDialog, type CellEditState } from "@/components/income-importer/income-cell-edit-dialog"
import { IncomeReviewStep } from "@/components/income-importer/income-review-step"
import { IncomeSuccessStep } from "@/components/income-importer/income-success-step"

export const INCOME_IMPORTER_DRAFT_KEY = "bitbudget-income-importer-draft"

type DialogStep = "calendar" | "review" | "success"

interface IncomeImporterDraft {
  step: DialogStep
  mode: ImportCalendarMode
  paintAmount: number
  paintSource: string
  scrollYear: number
  entries: StagedImportEntry[]
  lastClickedPeriod: string | null
}

function isDraft(value: unknown): value is IncomeImporterDraft {
  if (typeof value !== "object" || value == null) return false
  const d = value as IncomeImporterDraft
  return (
    (d.step === "calendar" || d.step === "review" || d.step === "success") &&
    (d.mode === "monthly" || d.mode === "annual") &&
    typeof d.paintAmount === "number" &&
    typeof d.paintSource === "string" &&
    typeof d.scrollYear === "number" &&
    Array.isArray(d.entries)
  )
}

function entriesFromDraft(entries: StagedImportEntry[]): Map<string, StagedImportEntry> {
  return new Map(entries.map((e) => [e.periodKey, e]))
}

interface IncomeImporterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IncomeImporterDialog({ open, onOpenChange }: IncomeImporterDialogProps) {
  const { activeTransactions, refreshData, state } = useApp()
  const [step, setStep] = useState<DialogStep>("calendar")
  const [mode, setMode] = useState<ImportCalendarMode>("monthly")
  const [paintAmount, setPaintAmount] = useState(0)
  const [paintSource, setPaintSource] = useState("")
  const [scrollYear, setScrollYear] = useState(() => new Date().getUTCFullYear())
  const [entries, setEntries] = useState<Map<string, StagedImportEntry>>(new Map())
  const [lastClickedPeriod, setLastClickedPeriod] = useState<string | null>(null)
  const [editState, setEditState] = useState<CellEditState | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successTotal, setSuccessTotal] = useState(0)

  const tx0 = useMemo(() => findTransactionHistoryStart(activeTransactions), [activeTransactions])

  const sumExistingForPeriod = useCallback(
    (periodKey: string): number => {
      const bounds = periodBoundsForExistingIncome(periodKey)
      if (!bounds) return 0
      const startMs = bounds.start.getTime()
      const endMs = bounds.end.getTime()
      return activeTransactions
        .filter((t) => {
          if (t.type !== "credit" || t.excludeFromMainHistory) return false
          const src = t.source ?? "manual"
          if (!EXISTING_INCOME_SOURCES.includes(src as (typeof EXISTING_INCOME_SOURCES)[number])) {
            return false
          }
          const d = new Date(`${t.date}T12:00:00.000Z`).getTime()
          return d >= startMs && d < endMs
        })
        .reduce((sum, t) => sum + t.amount, 0)
    },
    [activeTransactions],
  )

  const existingByPeriod = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries.values()) {
      map.set(e.periodKey, sumExistingForPeriod(e.periodKey))
    }
    return map
  }, [entries, sumExistingForPeriod])

  const priorImports = useMemo(() => {
    return activeTransactions
      .filter((t) => t.type === "credit" && t.source === "income_import" && !t.excludeFromMainHistory)
      .map((t) => ({ amount: t.amount, periodKey: t.date.slice(0, 7) }))
  }, [activeTransactions])

  const sumAllotments = useMemo(
    () =>
      state.envelopes
        .filter((e) => !e.archived && e.systemRole !== "savings")
        .reduce((s, e) => s + (e.monthlyAllotment > 0 ? e.monthlyAllotment : 0), 0),
    [state.envelopes],
  )

  const suggestedIncome = useMemo(
    () =>
      suggestedImportIncome({
        priorImports,
        monthlyIncome: state.monthlyIncome,
        latestSavingsGoal: null,
        sumAllotments,
      }),
    [priorImports, state.monthlyIncome, sumAllotments],
  )

  const hasDraftChanges = entries.size > 0 || paintAmount !== suggestedIncome || paintSource !== ""

  const hydrateDefaults = useCallback(() => {
    const income = suggestedImportIncome({
      priorImports,
      monthlyIncome: state.monthlyIncome,
      latestSavingsGoal: null,
      sumAllotments,
    })
    setStep("calendar")
    setMode("monthly")
    setPaintAmount(income > 0 ? income : 0)
    setPaintSource("")
    setScrollYear(new Date().getUTCFullYear())
    setEntries(new Map())
    setLastClickedPeriod(null)
    setError(null)
  }, [priorImports, state.monthlyIncome, sumAllotments])

  useEffect(() => {
    if (!open) return
    const draft = loadDraft(INCOME_IMPORTER_DRAFT_KEY, isDraft)
    if (draft) {
      setStep(draft.step === "success" ? "calendar" : draft.step)
      setMode(draft.mode)
      setPaintAmount(draft.paintAmount)
      setPaintSource(draft.paintSource)
      setScrollYear(draft.scrollYear)
      setEntries(entriesFromDraft(draft.entries))
      setLastClickedPeriod(draft.lastClickedPeriod)
    } else {
      hydrateDefaults()
    }
  }, [open, hydrateDefaults])

  useEffect(() => {
    if (!open) return
    saveDraft(INCOME_IMPORTER_DRAFT_KEY, {
      step,
      mode,
      paintAmount,
      paintSource,
      scrollYear,
      entries: [...entries.values()],
      lastClickedPeriod,
    })
  }, [open, step, mode, paintAmount, paintSource, scrollYear, entries, lastClickedPeriod])

  const stageEntries = useCallback((updates: StagedImportEntry[]) => {
    setEntries((prev) => {
      const next = new Map(prev)
      for (const u of updates) next.set(u.periodKey, u)
      return next
    })
  }, [])

  const entryList = useMemo(() => [...entries.values()], [entries])
  const summary = useMemo(() => {
    const existingMap = new Map<string, number>()
    for (const e of entryList) existingMap.set(e.periodKey, sumExistingForPeriod(e.periodKey))
    return summarizeImportEntries(entryList, existingMap)
  }, [entryList, sumExistingForPeriod])

  const hasPreTx0Staging = useMemo(() => {
    if (!tx0) return false
    return entryList.some((e) => {
      const parsed = parseIncomePeriodKey(e.periodKey)
      if (!parsed || parsed.kind === "year") return false
      return e.periodKey < tx0.periodKey
    })
  }, [entryList, tx0])

  const adjacentPeriodKeys = useMemo(() => {
    if (!editState) return []
    if (editState.kind === "year") {
      const y = Number(editState.periodKey)
      return [String(y - 1), String(y), String(y + 1)]
    }
    const parsed = parseIncomePeriodKey(editState.periodKey)
    if (!parsed || parsed.kind !== "month") return [editState.periodKey]
    const keys: string[] = []
    for (let m = 1; m <= 12; m++) {
      keys.push(`${parsed.year}-${String(m).padStart(2, "0")}`)
    }
    return keys
  }, [editState])

  const openEdit = (periodKey: string, kind: "month" | "year") => {
    const staged = entries.get(periodKey)
    setEditState({
      kind,
      periodKey,
      amount: staged?.amount ?? 0,
      source: staged?.source ?? paintSource,
      splitCount: staged?.splitCount ?? 12,
    })
    setEditOpen(true)
  }

  const needsMonthlyIncomeSetting = useMemo(
    () => entriesNeedMonthlyIncome(entryList),
    [entryList],
  )

  const submit = async () => {
    setError(null)
    if (entryList.length === 0) {
      setError("Paint at least one period with a positive amount.")
      return
    }
    if (needsMonthlyIncomeSetting && state.monthlyIncome <= 0) {
      setError(
        "Set a positive Monthly Income in Settings before importing the current month or future periods.",
      )
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/income-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entryList.map(({ periodKey, amount, source, splitCount }) => ({
            periodKey,
            amount,
            source,
            ...(splitCount != null ? { splitCount } : {}),
          })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Import failed.")
        return
      }
      await refreshData()
      clearDraft(INCOME_IMPORTER_DRAFT_KEY)
      setSuccessTotal(summary.totalPending)
      setStep("success")
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleClearAll = () => {
    hydrateDefaults()
    clearDraft(INCOME_IMPORTER_DRAFT_KEY)
    saveDraftImmediate(INCOME_IMPORTER_DRAFT_KEY, {
      step: "calendar",
      mode: "monthly",
      paintAmount: suggestedIncome,
      paintSource: "",
      scrollYear: new Date().getUTCFullYear(),
      entries: [],
      lastClickedPeriod: null,
    })
    setClearOpen(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[95vh] flex-col overflow-hidden bg-[#0D0D0D] border-[#1F1F1F] text-foreground sm:max-w-3xl w-[calc(100vw-1rem)] max-sm:h-[100dvh] max-sm:max-w-none max-sm:rounded-none">
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-start justify-between gap-2">
              <DialogTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#D4AF37]" aria-hidden />
                Import income
              </DialogTitle>
              {hasDraftChanges && step === "calendar" && (
                <Button type="button" variant="outline" size="sm" onClick={() => setClearOpen(true)}>
                  Clear All
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
            {step === "calendar" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Paint your income history on the calendar. Past periods credit Savings only; current and future
                  periods also fund envelopes.
                </p>
                <div className="flex gap-2 p-1 rounded-xl bg-[#111] border border-[#1F1F1F]">
                  {(["monthly", "annual"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`flex-1 py-2 text-sm rounded-lg capitalize transition-colors ${
                        mode === m ? "bg-[#D4AF37] text-[#0D0D0D] font-medium" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <IncomePaintBar
                  amount={paintAmount}
                  source={paintSource}
                  suggestedIncome={suggestedIncome}
                  onAmountChange={setPaintAmount}
                  onSourceChange={setPaintSource}
                />
                {hasPreTx0Staging && (
                  <p className="text-sm text-amber-400/95" role="status">
                    Some staged months are before your first recorded transaction. They still import as historical
                    income.
                  </p>
                )}
                <IncomeCalendar
                  mode={mode}
                  scrollYear={scrollYear}
                  onScrollYearChange={setScrollYear}
                  entries={entries}
                  existingByPeriod={existingByPeriod}
                  tx0PeriodKey={tx0?.periodKey ?? null}
                  paintAmount={paintAmount}
                  paintSource={paintSource}
                  onStageEntries={stageEntries}
                  onEditCell={openEdit}
                  lastClickedPeriod={lastClickedPeriod}
                  onLastClickedPeriodChange={setLastClickedPeriod}
                />
                <IncomeImporterLegend />
                {error && (
                  <p className="text-sm text-amber-400/95" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
                    disabled={entryList.length === 0}
                    onClick={() => {
                      setError(null)
                      setStep("review")
                    }}
                  >
                    Review import
                  </Button>
                </div>
              </>
            )}

            {step === "review" && (
              <IncomeReviewStep
                summary={summary}
                onBack={() => setStep("calendar")}
                onConfirm={() => void submit()}
                onEditRow={(pk) => openEdit(pk, entries.get(pk)?.kind ?? "month")}
                submitting={submitting}
                error={error}
              />
            )}

            {step === "success" && (
              <IncomeSuccessStep
                totalUsd={successTotal}
                monthCount={entryList.length}
                opportunityCostEnabled={state.opportunityCostEnabled}
                onClose={() => onOpenChange(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <IncomeCellEditDialog
        open={editOpen}
        state={editState}
        existingTotal={editState ? sumExistingForPeriod(editState.periodKey) : 0}
        adjacentPeriodKeys={adjacentPeriodKeys}
        onSave={(entry) => {
          stageEntries([entry])
          setEditOpen(false)
          setEditState(null)
        }}
        onCancel={() => {
          setEditOpen(false)
          setEditState(null)
        }}
        onNavigate={(pk) => {
          if (!editState) return
          const kind = editState.kind
          const staged = entries.get(pk)
          setEditState({
            kind,
            periodKey: pk,
            amount: staged?.amount ?? 0,
            source: staged?.source ?? paintSource,
            splitCount: staged?.splitCount ?? 12,
          })
        }}
      />

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F]">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset everything?</AlertDialogTitle>
            <AlertDialogDescription>
              Your staged income entries and paint settings will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAll}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
