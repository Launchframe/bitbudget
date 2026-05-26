"use client"

import { useMemo, useState, type MouseEvent } from "react"
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
import { INCOME_IMPORT_PAYEE_DEFAULT, isImportPeriodFuture, parseIncomePeriodKey } from "@/lib/income-import"
import {
  anchorForEditModeSwitch,
  buildEditPeriodKeys,
  stepEditAnchor,
  type ImportEditMode,
} from "@/lib/income-import-calendar"
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
  entries: Map<string, StagedImportEntry>
  paintSource: string
  getExistingTotal: (periodKey: string) => number
  onSave: (entry: StagedImportEntry) => void
  onCancel: () => void
}

function periodTitle(mode: ImportEditMode, periodKey: string): string {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return periodKey
  if (parsed.kind === "year") return periodKey
  const d = new Date(parsed.year, parsed.month - 1, 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function periodPillLabel(mode: ImportEditMode, periodKey: string): string {
  if (mode === "annual") return periodKey
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed || parsed.kind !== "month") return periodKey
  const d = new Date(parsed.year, parsed.month - 1, 1)
  return d.toLocaleDateString("en-US", { month: "short" })
}

const CELL_EDIT_TITLE_ID = "income-cell-edit-title"
const EDIT_STEP = 3

function initialNavState(initial: CellEditState) {
  const mode: ImportEditMode = initial.kind === "year" ? "annual" : "monthly"
  const keys = buildEditPeriodKeys(mode, initial.periodKey)
  return {
    mode,
    anchor: initial.periodKey,
    stepIndex: Math.max(0, keys.indexOf(initial.periodKey)),
  }
}

function stagedFieldDefaults(
  focusedKey: string,
  entries: Map<string, StagedImportEntry>,
  paintSource: string,
) {
  const staged = entries.get(focusedKey)
  return {
    amount: staged && staged.amount > 0 ? String(staged.amount) : "",
    source: staged?.source ?? paintSource,
    splitCount: staged?.splitCount ?? 12,
  }
}

function CellEditForm({
  initial,
  entries,
  paintSource,
  getExistingTotal,
  onSave,
  onCancel,
}: {
  initial: CellEditState
  entries: Map<string, StagedImportEntry>
  paintSource: string
  getExistingTotal: (periodKey: string) => number
  onSave: (entry: StagedImportEntry) => void
  onCancel: () => void
}) {
  const initialNav = initialNavState(initial)
  const [mode, setMode] = useState<ImportEditMode>(initialNav.mode)
  const [anchor, setAnchor] = useState(initialNav.anchor)
  const [stepIndex, setStepIndex] = useState(initialNav.stepIndex)

  const periodKeys = useMemo(() => buildEditPeriodKeys(mode, anchor), [mode, anchor])
  const focusedKey = periodKeys[stepIndex] ?? periodKeys[0] ?? anchor
  const focusedStaged = entries.get(focusedKey)
  const entryKind = mode === "annual" ? "year" : "month"
  const focusedIsFuture = isImportPeriodFuture(focusedKey)
  const canStepForward = !isImportPeriodFuture(stepEditAnchor(mode, anchor, EDIT_STEP))

  const [fieldOverrides, setFieldOverrides] = useState<
    Record<string, { amount?: string; source?: string; splitCount?: number }>
  >({})
  const stagedDefaults = stagedFieldDefaults(focusedKey, entries, paintSource)
  const fieldOverride = fieldOverrides[focusedKey]
  const amount = fieldOverride?.amount ?? stagedDefaults.amount
  const source = fieldOverride?.source ?? stagedDefaults.source
  const splitCount = fieldOverride?.splitCount ?? stagedDefaults.splitCount

  const setAmount = (value: string) => {
    setFieldOverrides((prev) => ({
      ...prev,
      [focusedKey]: { ...prev[focusedKey], amount: value },
    }))
  }
  const setSource = (value: string) => {
    setFieldOverrides((prev) => ({
      ...prev,
      [focusedKey]: { ...prev[focusedKey], source: value },
    }))
  }
  const setSplitCount = (value: number) => {
    setFieldOverrides((prev) => ({
      ...prev,
      [focusedKey]: { ...prev[focusedKey], splitCount: value },
    }))
  }

  const handleModeChange = (next: ImportEditMode) => {
    setMode(next)
    setAnchor(anchorForEditModeSwitch(next, anchor))
    setStepIndex(0)
  }

  const handleCancel = (e: MouseEvent) => {
    e.stopPropagation()
    onCancel()
  }

  const title = periodTitle(mode, focusedKey)
  const existingTotal = getExistingTotal(focusedKey)

  return (
    <>
      <DialogHeader>
        <DialogTitle id={CELL_EDIT_TITLE_ID}>Edit past income</DialogTitle>
      </DialogHeader>

      <div className="flex gap-2 rounded-xl border border-[#1F1F1F] bg-[#111] p-1">
        {(["monthly", "annual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`flex-1 rounded-lg py-2 text-sm capitalize transition-colors ${
              mode === m
                ? "bg-[#D4AF37] font-medium text-[#0D0D0D]"
                : "text-muted-foreground hover:text-foreground"
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
          aria-label={mode === "annual" ? "Previous three years" : "Previous three months"}
          onClick={() => {
            setAnchor(stepEditAnchor(mode, anchor, -EDIT_STEP))
            setStepIndex(0)
          }}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-center text-sm font-medium">{title}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={mode === "annual" ? "Next three years" : "Next three months"}
          disabled={!canStepForward}
          onClick={() => {
            if (!canStepForward) return
            setAnchor(stepEditAnchor(mode, anchor, EDIT_STEP))
            setStepIndex(0)
          }}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-2">
        {periodKeys.map((key, i) => {
          const pillFuture = isImportPeriodFuture(key)
          return (
            <button
              key={key}
              type="button"
              disabled={pillFuture}
              onClick={() => {
                if (pillFuture) return
                setStepIndex(i)
              }}
              className={`flex-1 rounded-lg border py-1.5 text-xs transition-colors ${
                pillFuture
                  ? "cursor-not-allowed border-[#1F1F1F] text-muted-foreground/50 opacity-50"
                  : stepIndex === i
                    ? "border-[#D4AF37]/50 bg-[#D4AF37]/10 text-foreground"
                    : "border-[#1F1F1F] text-muted-foreground hover:text-foreground"
              }`}
              aria-current={stepIndex === i ? "step" : undefined}
            >
              {periodPillLabel(mode, key)}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[#1F1F1F] bg-[#111] p-4">
        <p className="text-xs text-muted-foreground">
          Previously added: ${existingTotal.toFixed(2)}
          {focusedStaged && focusedStaged.amount > 0 && (
            <span className="text-foreground">
              {" "}
              · New amount: ${focusedStaged.amount.toFixed(2)}
            </span>
          )}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-amount">Total income (USD)</Label>
          <Input
            id="edit-amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="border-[#333] bg-[#1A1A1A]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-source">Employer or source (optional)</Label>
          <Input
            id="edit-source"
            placeholder={INCOME_IMPORT_PAYEE_DEFAULT}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="border-[#333] bg-[#1A1A1A]"
          />
        </div>
        {mode === "annual" && (
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
              className="border-[#333] bg-[#1A1A1A]"
            />
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
          disabled={focusedIsFuture}
          onClick={() => {
            if (focusedIsFuture) return
            const amt = parseFloat(amount)
            if (!Number.isFinite(amt) || amt <= 0) return
            onSave({
              periodKey: focusedKey,
              amount: amt,
              source: source.trim() || undefined,
              kind: entryKind,
              ...(mode === "annual" ? { splitCount } : {}),
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
  entries,
  paintSource,
  getExistingTotal,
  onSave,
  onCancel,
}: IncomeCellEditDialogProps) {
  if (!state) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent
        className="z-[60] max-w-md border-[#1F1F1F] bg-[#0D0D0D] text-foreground"
        aria-labelledby={CELL_EDIT_TITLE_ID}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <CellEditForm
          key={`${state.kind}-${state.periodKey}`}
          initial={state}
          entries={entries}
          paintSource={paintSource}
          getExistingTotal={getExistingTotal}
          onSave={onSave}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
