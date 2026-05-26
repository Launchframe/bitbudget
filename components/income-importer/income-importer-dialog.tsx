"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TrendingUp } from "lucide-react"
import { useApp } from "@/lib/app-context"
import {
  entriesNeedMonthlyIncome,
  isImportPeriodFuture,
  parseIncomePeriodKey,
  sumPriorIncomeImportForPeriod,
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
import { IncomeCsvImport } from "@/components/income-importer/income-csv-import"

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

function isStagedEntry(value: unknown): value is StagedImportEntry {
  if (typeof value !== "object" || value == null) return false
  const e = value as StagedImportEntry
  if (typeof e.periodKey !== "string" || !parseIncomePeriodKey(e.periodKey)) return false
  if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount <= 0) return false
  if (e.kind !== "month" && e.kind !== "year") return false
  if (e.source != null && typeof e.source !== "string") return false
  if (e.splitCount != null && (!Number.isFinite(e.splitCount) || e.splitCount < 1 || e.splitCount > 52)) {
    return false
  }
  return true
}

function isDraft(value: unknown): value is IncomeImporterDraft {
  if (typeof value !== "object" || value == null) return false
  const d = value as IncomeImporterDraft
  const lastClickedOk =
    d.lastClickedPeriod === null ||
    (typeof d.lastClickedPeriod === "string" && parseIncomePeriodKey(d.lastClickedPeriod) != null)
  return (
    (d.step === "calendar" || d.step === "review" || d.step === "success") &&
    (d.mode === "monthly" || d.mode === "annual") &&
    Number.isFinite(d.paintAmount) &&
    d.paintAmount >= 0 &&
    typeof d.paintSource === "string" &&
    Number.isFinite(d.scrollYear) &&
    Number.isInteger(d.scrollYear) &&
    Array.isArray(d.entries) &&
    d.entries.every(isStagedEntry) &&
    lastClickedOk
  )
}

function entriesFromDraft(entries: StagedImportEntry[]): Map<string, StagedImportEntry> {
  return new Map(
    entries.filter((e) => !isImportPeriodFuture(e.periodKey)).map((e) => [e.periodKey, e]),
  )
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
  /** Sync guard for parent onOpenChange — React state can lag behind Radix dismiss events. */
  const childModalOpenRef = useRef(false)
  const openHydratedRef = useRef(false)

  useEffect(() => {
    childModalOpenRef.current = editOpen || clearOpen
  }, [editOpen, clearOpen])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [csvStatus, setCsvStatus] = useState<string | null>(null)
  const [successTotal, setSuccessTotal] = useState(0)

  const tx0 = useMemo(() => findTransactionHistoryStart(activeTransactions), [activeTransactions])

  const sumPriorImportForPeriod = useCallback(
    (periodKey: string): number =>
      sumPriorIncomeImportForPeriod(activeTransactions, periodKey),
    [activeTransactions],
  )

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
    setCsvStatus(null)
  }, [priorImports, state.monthlyIncome, sumAllotments])

  useEffect(() => {
    if (!open) {
      openHydratedRef.current = false
      return
    }
    if (openHydratedRef.current) return
    openHydratedRef.current = true

    const draft = loadDraft(INCOME_IMPORTER_DRAFT_KEY, isDraft)
    if (draft) {
      setStep(draft.step === "success" ? "calendar" : draft.step)
      setMode(draft.mode)
      setPaintAmount(draft.paintAmount)
      setPaintSource(draft.paintSource)
      setScrollYear(draft.scrollYear)
      setEntries(entriesFromDraft(draft.entries))
      setLastClickedPeriod(draft.lastClickedPeriod)
      setError(null)
      setCsvStatus(null)
      setSubmitting(false)
    } else {
      hydrateDefaults()
    }
  }, [open, hydrateDefaults])

  useEffect(() => {
    if (!open || step === "success") return
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
      for (const u of updates) {
        if (isImportPeriodFuture(u.periodKey)) continue
        if (!Number.isFinite(u.amount) || u.amount <= 0) next.delete(u.periodKey)
        else next.set(u.periodKey, u)
      }
      return next
    })
  }, [])

  const entryList = useMemo(() => [...entries.values()], [entries])
  const summary = useMemo(() => {
    const existingMap = new Map<string, number>()
    for (const e of entryList) existingMap.set(e.periodKey, sumPriorImportForPeriod(e.periodKey))
    return summarizeImportEntries(entryList, existingMap)
  }, [entryList, sumPriorImportForPeriod])

  const hasPreTx0Staging = useMemo(() => {
    if (!tx0) return false
    return entryList.some((e) => {
      const parsed = parseIncomePeriodKey(e.periodKey)
      if (!parsed || parsed.kind === "year") return false
      return e.periodKey < tx0.periodKey
    })
  }, [entryList, tx0])

  const closeEdit = () => {
    setEditOpen(false)
    setEditState(null)
  }

  const openEdit = (periodKey: string, kind: "month" | "year") => {
    if (isImportPeriodFuture(periodKey)) return
    childModalOpenRef.current = true
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

  const handleCsvImport = useCallback(
    (result: {
      entries: StagedImportEntry[]
      scrollYear: number
      monthCount: number
      skippedRows: number
    }) => {
      setError(null)
      setMode("monthly")
      setScrollYear(result.scrollYear)
      stageEntries(result.entries)
      const skipNote =
        result.skippedRows > 0 ? ` ${result.skippedRows} row${result.skippedRows === 1 ? "" : "s"} skipped.` : ""
      setCsvStatus(
        `Loaded ${result.monthCount} month${result.monthCount === 1 ? "" : "s"} from CSV.${skipNote} Review the calendar, then continue to Review import.`,
      )
    },
    [stageEntries],
  )

  const submit = async () => {
    setError(null)
    if (entryList.length === 0) {
      setError("Paint at least one period with a positive amount.")
      return
    }
    if (needsMonthlyIncomeSetting && state.monthlyIncome <= 0) {
      setError(
        "Set a positive Monthly Income in Settings before importing the current month or year.",
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
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && childModalOpenRef.current) return
          onOpenChange(next)
        }}
      >
        <DialogContent className="flex max-h-[95vh] flex-col overflow-hidden bg-[#0D0D0D] border-[#1F1F1F] text-foreground w-[calc(100vw-1rem)] max-sm:h-[100dvh] max-sm:max-w-none max-sm:rounded-none sm:max-w-4xl lg:max-w-5xl">
          <DialogHeader className="flex-shrink-0 space-y-0 pr-10">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-x-3">
              <DialogTitle className="flex min-w-0 items-center gap-2 text-left">
                <TrendingUp className="h-4 w-4 shrink-0 text-[#D4AF37]" aria-hidden />
                Import income
              </DialogTitle>
              {step === "calendar" && (
                <div className="flex min-w-0 flex-wrap items-center gap-2 shrink-0">
                  {hasDraftChanges && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        childModalOpenRef.current = true
                        setClearOpen(true)
                      }}
                    >
                      Clear All
                    </Button>
                  )}
                  <IncomeCsvImport
                    onImported={handleCsvImport}
                    onError={(message) => {
                      setCsvStatus(null)
                      setError(message)
                    }}
                  />
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
            {step === "calendar" && (
              <>
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
                  tx0PeriodKey={tx0?.periodKey ?? null}
                  paintAmount={paintAmount}
                  paintSource={paintSource}
                  onStageEntries={stageEntries}
                  onEditCell={openEdit}
                  lastClickedPeriod={lastClickedPeriod}
                  onLastClickedPeriodChange={setLastClickedPeriod}
                />
                <IncomeImporterLegend />
                {csvStatus && (
                  <p className="text-sm text-[#D4AF37]/95" role="status">
                    {csvStatus}
                  </p>
                )}
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

          <IncomeCellEditDialog
            open={editOpen}
            state={editState}
            entries={entries}
            paintSource={paintSource}
            getExistingTotal={sumPriorImportForPeriod}
            onSave={(entry) => {
              stageEntries([entry])
              closeEdit()
            }}
            onCancel={closeEdit}
          />
        </DialogContent>
      </Dialog>

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
