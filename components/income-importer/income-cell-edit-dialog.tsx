"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { INCOME_IMPORT_PAYEE_DEFAULT, parseIncomePeriodKey } from "@/lib/income-import"
import type { StagedImportEntry } from "@/components/income-importer/income-calendar"

export interface CellEditState {
  kind: "month" | "year"
  periodKey: string
  amount: number
  source: string
  splitCount: number
}

interface IncomeCellEditDialogProps {
  open: boolean
  state: CellEditState | null
  existingTotal: number
  adjacentPeriodKeys: string[]
  onSave: (entry: StagedImportEntry) => void
  onCancel: () => void
  onNavigate: (periodKey: string) => void
}

function periodLabel(periodKey: string): string {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return periodKey
  if (parsed.kind === "year") return periodKey
  const d = new Date(parsed.year, parsed.month - 1, 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function CellEditForm({
  state,
  existingTotal,
  adjacentPeriodKeys,
  onSave,
  onCancel,
  onNavigate,
}: {
  state: CellEditState
  existingTotal: number
  adjacentPeriodKeys: string[]
  onSave: (entry: StagedImportEntry) => void
  onCancel: () => void
  onNavigate: (periodKey: string) => void
}) {
  const [amount, setAmount] = useState(state.amount > 0 ? String(state.amount) : "")
  const [source, setSource] = useState(state.source)
  const [splitCount, setSplitCount] = useState(state.splitCount)

  const idx = adjacentPeriodKeys.indexOf(state.periodKey)
  const canPrev = idx > 0
  const canNext = idx >= 0 && idx < adjacentPeriodKeys.length - 1
  const title = periodLabel(state.periodKey)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={!canPrev}
          aria-label="Previous period"
          onClick={() => onNavigate(adjacentPeriodKeys[idx - 1]!)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">Existing: ${existingTotal.toFixed(2)}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={!canNext}
          aria-label="Next period"
          onClick={() => onNavigate(adjacentPeriodKeys[idx + 1]!)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-amount">Total income (USD)</Label>
          <Input
            id="edit-amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-source">Source label</Label>
          <Input
            id="edit-source"
            placeholder={INCOME_IMPORT_PAYEE_DEFAULT}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
        {state.kind === "year" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-split">Paychecks per year</Label>
            <Input
              id="edit-split"
              type="number"
              min={1}
              max={52}
              value={splitCount}
              onChange={(e) =>
                setSplitCount(Math.max(1, Math.min(52, parseInt(e.target.value, 10) || 1)))
              }
              className="bg-[#1A1A1A] border-[#333]"
            />
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
          onClick={() => {
            const amt = parseFloat(amount)
            if (!Number.isFinite(amt) || amt <= 0) return
            onSave({
              periodKey: state.periodKey,
              amount: amt,
              source: source.trim() || undefined,
              kind: state.kind,
              ...(state.kind === "year" ? { splitCount } : {}),
            })
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  )
}

export function IncomeCellEditDialog({
  open,
  state,
  existingTotal,
  adjacentPeriodKeys,
  onSave,
  onCancel,
  onNavigate,
}: IncomeCellEditDialogProps) {
  const title = useMemo(() => (state ? periodLabel(state.periodKey) : "Edit"), [state])

  if (!state) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md" aria-labelledby={title}>
        <CellEditForm
          key={state.periodKey}
          state={state}
          existingTotal={existingTotal}
          adjacentPeriodKeys={adjacentPeriodKeys}
          onSave={onSave}
          onCancel={onCancel}
          onNavigate={onNavigate}
        />
      </DialogContent>
    </Dialog>
  )
}
