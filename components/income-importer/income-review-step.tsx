"use client"

import { formatUsd } from "@/lib/data"
import { parseIncomePeriodKey } from "@/lib/income-import"
import type { ImportSummary } from "@/lib/income-import-calendar"
import { Button } from "@/components/ui/button"

interface IncomeReviewStepProps {
  summary: ImportSummary
  onBack: () => void
  onConfirm: () => void
  onEditRow: (periodKey: string) => void
  submitting: boolean
  error: string | null
}

function rowLabel(periodKey: string): string {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return periodKey
  if (parsed.kind === "year") return periodKey
  const d = new Date(parsed.year, parsed.month - 1, 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export function IncomeReviewStep({
  summary,
  onBack,
  onConfirm,
  onEditRow,
  submitting,
  error,
}: IncomeReviewStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Review staged income before importing.</p>
      <ul className="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
        {summary.rows.map((row) => (
          <li key={row.periodKey}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#1F1F1F] bg-[#111] px-3 py-2 text-left hover:border-[#D4AF37]/40"
              onClick={() => onEditRow(row.periodKey)}
            >
              <span>{rowLabel(row.periodKey)}</span>
              <span className="text-right">
                {formatUsd(row.newAmount)}
                {row.delta !== 0 && (
                  <span className={row.delta > 0 ? " text-success" : " text-amber-400"}>
                    {" "}
                    ({row.delta > 0 ? "+" : ""}
                    {formatUsd(row.delta)} vs prior import)
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total income after import</span>
          <span>{formatUsd(summary.totalCombined)}</span>
        </div>
        <div className="mt-1 flex justify-between font-medium text-[#D4AF37]">
          <span>Import income (pending)</span>
          <span>{formatUsd(summary.totalPending)}</span>
        </div>
      </div>
      {error && (
        <p className="text-sm text-amber-400/95" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
          disabled={submitting || summary.rows.length === 0}
          onClick={onConfirm}
        >
          {submitting ? "Importing…" : "Confirm import"}
        </Button>
      </div>
    </div>
  )
}
