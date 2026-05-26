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
    <div className="flex flex-col gap-4 min-w-0">
      <p className="text-sm text-muted-foreground">Review staged income before importing.</p>
      <div className="max-h-[50vh] min-h-0 overflow-auto rounded-xl border border-[#1F1F1F] bg-[#111]">
        <table className="w-full min-w-[16rem] text-sm">
          <thead className="sticky top-0 z-10 bg-[#111] shadow-[0_1px_0_0_#1F1F1F]">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-3 py-2.5 font-medium">
                Date
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Was
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Now
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr
                key={row.periodKey}
                tabIndex={0}
                role="button"
                aria-label={`Edit ${rowLabel(row.periodKey)}`}
                className="cursor-pointer border-b border-[#1F1F1F] last:border-b-0 hover:bg-[#1A1A1A] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D4AF37]/50"
                onClick={() => onEditRow(row.periodKey)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onEditRow(row.periodKey)
                  }
                }}
              >
                <td className="px-3 py-2.5 min-w-0 text-foreground">{rowLabel(row.periodKey)}</td>
                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">
                  {row.existingAmount > 0 ? formatUsd(row.existingAmount) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-medium text-[#D4AF37] tabular-nums">
                  {formatUsd(row.newAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-3 text-sm">
        {summary.totalExisting > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">History to overwrite</span>
            <span className="tabular-nums">{formatUsd(summary.totalExisting)}</span>
          </div>
        )}
        <div
          className={`flex justify-between gap-4 font-medium text-[#D4AF37]${summary.totalExisting > 0 ? " mt-1" : ""}`}
        >
          <span>New history total</span>
          <span className="tabular-nums">{formatUsd(summary.totalPending)}</span>
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
