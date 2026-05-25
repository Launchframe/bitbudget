"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import {
  currentMonthKeyUtc,
  currentYearUtc,
  EXISTING_INCOME_SOURCES,
  INCOME_IMPORT_PAYEE_DEFAULT,
  parseIncomePeriodKey,
  periodBoundsForExistingIncome,
} from "@/lib/income-import"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react"

type ImportMode = "monthly" | "annual"

interface PeriodRow {
  periodKey: string
  label: string
  existingTotal: number
  amount: string
  source: string
  splitCount: number
  enabled: boolean
}

interface IncomeImporterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function monthLabel(periodKey: string): string {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed || parsed.kind !== "month") return periodKey
  const d = new Date(parsed.year, parsed.month - 1, 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function buildPeriodKeys(mode: ImportMode, anchor: string): string[] {
  if (mode === "annual") {
    const year = Number(anchor)
    return [`${year - 2}`, `${year - 1}`, `${year}`]
  }
  const [y, m] = anchor.split("-").map(Number)
  const keys: string[] = []
  for (let i = -2; i <= 0; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return keys
}

function stepAnchor(mode: ImportMode, anchor: string, delta: number): string {
  if (mode === "annual") {
    return String(Number(anchor) + delta)
  }
  const [y, m] = anchor.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export function IncomeImporterDialog({ open, onOpenChange }: IncomeImporterDialogProps) {
  const { activeTransactions, refreshData } = useApp()
  const [mode, setMode] = useState<ImportMode>("monthly")
  const [anchor, setAnchor] = useState(mode === "monthly" ? currentMonthKeyUtc() : String(currentYearUtc()))
  const [stepIndex, setStepIndex] = useState(0)
  const [rows, setRows] = useState<PeriodRow[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const periodKeys = useMemo(() => buildPeriodKeys(mode, anchor), [mode, anchor])
  const focusedKey = periodKeys[stepIndex] ?? periodKeys[0] ?? anchor

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

  useEffect(() => {
    if (!open) return
    setError(null)
    setConfirmOpen(false)
    setStepIndex(0)
    const keys = buildPeriodKeys(mode, anchor)
    setRows(
      keys.map((periodKey) => {
        const existing = sumExistingForPeriod(periodKey)
        return {
          periodKey,
          label: mode === "annual" ? periodKey : monthLabel(periodKey),
          existingTotal: existing,
          amount: existing > 0 ? existing.toFixed(2) : "",
          source: "",
          splitCount: 12,
          enabled: existing <= 0,
        }
      }),
    )
  }, [open, mode, anchor, sumExistingForPeriod])

  const focusedRow = rows[stepIndex]
  const importTotal = useMemo(() => {
    return rows.reduce((sum, row) => {
      if (!row.enabled) return sum
      const amt = parseFloat(row.amount)
      return sum + (Number.isFinite(amt) && amt > 0 ? amt : 0)
    }, 0)
  }, [rows])

  const enabledCount = rows.filter((r) => r.enabled && parseFloat(r.amount) > 0).length

  const updateRow = (index: number, patch: Partial<PeriodRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const handleModeChange = (next: ImportMode) => {
    setMode(next)
    setAnchor(next === "monthly" ? currentMonthKeyUtc() : String(currentYearUtc()))
    setStepIndex(0)
  }

  const submit = async () => {
    setError(null)
    const entries = rows
      .filter((r) => r.enabled)
      .map((r) => {
        const amt = parseFloat(r.amount)
        if (!Number.isFinite(amt) || amt <= 0) return null
        return {
          periodKey: r.periodKey,
          amount: amt,
          source: r.source.trim() || undefined,
          ...(mode === "annual" ? { splitCount: r.splitCount } : {}),
        }
      })
      .filter((e): e is NonNullable<typeof e> => e != null)

    if (entries.length === 0) {
      setError("Enable at least one period with a positive amount.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/income-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Import failed.")
        return
      }
      await refreshData()
      onOpenChange(false)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#D4AF37]" aria-hidden />
            Import income
          </DialogTitle>
        </DialogHeader>

        {!confirmOpen ? (
          <>
            <p className="text-xs text-muted-foreground">
              Backfill paycheck history so Savings analytics reflect your real income. Past periods credit Savings
              only; current and future periods also fund envelopes.
            </p>

            <div className="flex gap-2 p-1 rounded-xl bg-[#111] border border-[#1F1F1F]">
              {(["monthly", "annual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`flex-1 py-2 text-sm rounded-lg capitalize transition-colors ${
                    mode === m ? "bg-[#D4AF37] text-[#0D0D0D] font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => handleModeChange(m)}
                  aria-pressed={mode === m}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Previous period"
                onClick={() => {
                  setAnchor(stepAnchor(mode, anchor, mode === "annual" ? -3 : -3))
                  setStepIndex(0)
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium">{focusedRow?.label ?? focusedKey}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Next period"
                onClick={() => {
                  setAnchor(stepAnchor(mode, anchor, mode === "annual" ? 3 : 3))
                  setStepIndex(0)
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex gap-2">
              {periodKeys.map((key, i) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStepIndex(i)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border ${
                    stepIndex === i
                      ? "border-[#D4AF37]/50 bg-[#D4AF37]/10 text-foreground"
                      : "border-[#1F1F1F] text-muted-foreground"
                  }`}
                  aria-current={stepIndex === i ? "step" : undefined}
                >
                  {mode === "annual" ? key : monthLabel(key).split(" ")[0]}
                </button>
              ))}
            </div>

            {focusedRow && (
              <div className="flex flex-col gap-3 p-4 rounded-xl border border-[#1F1F1F] bg-[#111]">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="import-enabled" className="text-sm">
                    Import this period
                  </Label>
                  <Switch
                    id="import-enabled"
                    checked={focusedRow.enabled}
                    onCheckedChange={(v) => updateRow(stepIndex, { enabled: v })}
                    aria-label={`Import ${focusedRow.label}`}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Existing income recorded: {formatUsd(focusedRow.existingTotal)}
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-amount">Total income (USD)</Label>
                  <Input
                    id="import-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!focusedRow.enabled}
                    value={focusedRow.amount}
                    onChange={(e) => updateRow(stepIndex, { amount: e.target.value })}
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-source">Source label (optional)</Label>
                  <Input
                    id="import-source"
                    disabled={!focusedRow.enabled}
                    placeholder={INCOME_IMPORT_PAYEE_DEFAULT}
                    value={focusedRow.source}
                    onChange={(e) => updateRow(stepIndex, { source: e.target.value })}
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
                {mode === "annual" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="import-split">Across how many paychecks?</Label>
                    <Input
                      id="import-split"
                      type="number"
                      min={1}
                      max={52}
                      disabled={!focusedRow.enabled}
                      value={focusedRow.splitCount}
                      onChange={(e) =>
                        updateRow(stepIndex, {
                          splitCount: Math.max(1, Math.min(52, parseInt(e.target.value, 10) || 1)),
                        })
                      }
                      className="bg-[#1A1A1A] border-[#333]"
                    />
                  </div>
                )}
              </div>
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
                disabled={enabledCount === 0}
                onClick={() => setConfirmOpen(true)}
              >
                Review import
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground">Confirm before importing:</p>
            <ul className="text-sm text-muted-foreground space-y-2 max-h-48 overflow-y-auto">
              {rows
                .filter((r) => r.enabled && parseFloat(r.amount) > 0)
                .map((r) => {
                  const amt = parseFloat(r.amount)
                  const delta = amt - r.existingTotal
                  return (
                    <li key={r.periodKey} className="flex justify-between gap-2">
                      <span>{r.label}</span>
                      <span>
                        {formatUsd(amt)}
                        {delta !== 0 && (
                          <span className={delta > 0 ? " text-success" : " text-amber-400"}>
                            {" "}
                            ({delta > 0 ? "+" : ""}
                            {formatUsd(delta)} vs recorded)
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
            </ul>
            <p className="text-sm font-medium text-[#D4AF37]">Total: {formatUsd(importTotal)}</p>
            {error && (
              <p className="text-sm text-amber-400/95" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                Back
              </Button>
              <Button
                type="button"
                className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Importing…" : "Confirm import"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Prominent Settings card — mirrors Import Transactions on Integrations. */
export function IncomeImporterCard() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#D4AF37]/10">
            <TrendingUp className="h-5 w-5 text-[#D4AF37]" aria-hidden />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Import Income History</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Backfill monthly or annual income so Savings and analytics reflect your real cash flow. Past periods credit
          Savings only; the current month and future periods also fund your envelopes.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-[#222] sm:w-auto"
        >
          <TrendingUp className="h-4 w-4 text-[#D4AF37]" aria-hidden />
          Import income history
        </button>
      </div>
      <IncomeImporterDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
