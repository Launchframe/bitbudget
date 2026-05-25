"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Pencil } from "lucide-react"
import type { IncomeImportEntry } from "@/lib/income-import"
import { parseIncomePeriodKey } from "@/lib/income-import"
import {
  buildCalendarYears,
  cellState,
  heatmapIntensity,
  maxStagedAmount,
  monthsInRangeChronological,
  type CellVisualState,
} from "@/lib/income-import-calendar"
import { cellBackgroundStyle } from "@/components/income-importer/legend"

const MONTHS = [
  { full: "January", short: "Jan", letter: "J" },
  { full: "February", short: "Feb", letter: "F" },
  { full: "March", short: "Mar", letter: "M" },
  { full: "April", short: "Apr", letter: "A" },
  { full: "May", short: "May", letter: "M" },
  { full: "June", short: "Jun", letter: "J" },
  { full: "July", short: "Jul", letter: "J" },
  { full: "August", short: "Aug", letter: "A" },
  { full: "September", short: "Sep", letter: "S" },
  { full: "October", short: "Oct", letter: "O" },
  { full: "November", short: "Nov", letter: "N" },
  { full: "December", short: "Dec", letter: "D" },
]

/** Calendar quarters for mobile (3 months per row). */
const QUARTER_MONTH_INDICES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
] as const

export type ImportCalendarMode = "monthly" | "annual"

export interface StagedImportEntry extends IncomeImportEntry {
  kind: "month" | "year"
}

interface IncomeCalendarProps {
  mode: ImportCalendarMode
  scrollYear: number
  onScrollYearChange: (year: number) => void
  entries: Map<string, StagedImportEntry>
  tx0PeriodKey: string | null
  paintAmount: number
  paintSource: string
  onStageEntries: (updates: StagedImportEntry[]) => void
  onEditCell: (periodKey: string, kind: "month" | "year") => void
  lastClickedPeriod: string | null
  onLastClickedPeriodChange: (key: string | null) => void
}

function monthPeriodKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`
}

function cellClass(state: CellVisualState): string {
  switch (state) {
    case "tx0":
      return "border-2 border-[#D4AF37] bg-[#1A1A1A]"
    case "preHistory":
      return "border border-[#222] bg-[#111] opacity-50"
    case "shaded":
      return "border border-[#D4AF37]/50"
    default:
      return "border border-[#333] bg-[#1A1A1A] hover:border-[#555]"
  }
}

export function IncomeCalendar({
  mode,
  scrollYear,
  onScrollYearChange,
  entries,
  tx0PeriodKey,
  paintAmount,
  paintSource,
  onStageEntries,
  onEditCell,
  lastClickedPeriod,
  onLastClickedPeriodChange,
}: IncomeCalendarProps) {
  const years = useMemo(() => buildCalendarYears(new Date().getUTCFullYear()), [])
  const dragStartRef = useRef<string | null>(null)
  const dragEndRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const didDragRef = useRef(false)
  const [focusPeriod, setFocusPeriod] = useState<string | null>(null)
  const [mobileEditPeriod, setMobileEditPeriod] = useState<string | null>(null)

  const stagedAmounts = useMemo(() => [...entries.values()].map((e) => e.amount), [entries])
  const heatmapMax = useMemo(() => maxStagedAmount(stagedAmounts), [stagedAmounts])

  const applyPaint = useCallback(
    (periodKeys: string[], kind: "month" | "year") => {
      if (paintAmount <= 0) return
      const source = paintSource.trim() || undefined
      onStageEntries(
        periodKeys.map((periodKey) => ({
          periodKey,
          amount: paintAmount,
          source,
          kind,
          ...(kind === "year" ? { splitCount: entries.get(periodKey)?.splitCount ?? 12 } : {}),
        })),
      )
    },
    [entries, onStageEntries, paintAmount, paintSource],
  )

  const finishMonthDrag = useCallback(() => {
    const start = dragStartRef.current
    const end = dragEndRef.current ?? start
    dragStartRef.current = null
    dragEndRef.current = null
    isDraggingRef.current = false
    if (!start || !end) return
    if (start !== end) didDragRef.current = true
    if (start === end) {
      applyPaint([start], "month")
    } else {
      applyPaint(monthsInRangeChronological(start, end), "month")
    }
    onLastClickedPeriodChange(end)
  }, [applyPaint, onLastClickedPeriodChange])

  useEffect(() => {
    const onWindowPointerUp = () => {
      if (!isDraggingRef.current) return
      finishMonthDrag()
    }
    window.addEventListener("pointerup", onWindowPointerUp)
    window.addEventListener("pointercancel", onWindowPointerUp)
    return () => {
      window.removeEventListener("pointerup", onWindowPointerUp)
      window.removeEventListener("pointercancel", onWindowPointerUp)
    }
  }, [finishMonthDrag])

  const beginMonthDrag = (periodKey: string, shiftKey: boolean) => {
    if (shiftKey && lastClickedPeriod) {
      applyPaint(monthsInRangeChronological(lastClickedPeriod, periodKey), "month")
      onLastClickedPeriodChange(periodKey)
      return
    }
    didDragRef.current = false
    isDraggingRef.current = true
    dragStartRef.current = periodKey
    dragEndRef.current = periodKey
  }

  const updateMonthDrag = (periodKey: string) => {
    if (!isDraggingRef.current) return
    dragEndRef.current = periodKey
    if (periodKey !== dragStartRef.current) didDragRef.current = true
  }

  const renderCell = (
    periodKey: string,
    kind: "month" | "year",
    label: string,
    options?: { compact?: boolean; showMonthShort?: boolean },
  ) => {
    const staged = entries.get(periodKey)
    const amount = staged?.amount ?? 0
    const intensity = heatmapIntensity(amount, heatmapMax)
    const visual = cellState({ periodKey, tx0PeriodKey, amount, intensity })
    const showEdit = mobileEditPeriod === periodKey
    const monthIdx = kind === "month" ? parseInt(periodKey.split("-")[1]!, 10) - 1 : -1

    return (
      <div
        key={periodKey}
        role="gridcell"
        tabIndex={0}
        aria-label={`${label}${amount > 0 ? `, staged ${amount} dollars` : ""}`}
        className={`relative w-full rounded-md touch-none ${options?.compact ? "min-h-10" : "aspect-square min-h-8"} ${cellClass(visual)} group focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/60`}
        style={visual === "shaded" ? cellBackgroundStyle(intensity) : undefined}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-edit-btn]")) return
          if (kind === "month") {
            beginMonthDrag(periodKey, e.shiftKey)
            return
          }
          applyPaint([periodKey], "year")
          onLastClickedPeriodChange(periodKey)
        }}
        onPointerEnter={() => {
          if (kind === "month") updateMonthDrag(periodKey)
        }}
        onFocus={() => setFocusPeriod(periodKey)}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" && e.shiftKey && lastClickedPeriod && kind === "month") {
            e.preventDefault()
            applyPaint(monthsInRangeChronological(lastClickedPeriod, periodKey), "month")
            onLastClickedPeriodChange(periodKey)
            return
          }
          if (e.key === "Enter") {
            e.preventDefault()
            onEditCell(periodKey, kind)
            return
          }
          const parsed = parseIncomePeriodKey(periodKey)
          if (!parsed || parsed.kind !== "month") return
          let next: string | null = null
          if (e.key === "ArrowRight" && parsed.month < 12) {
            next = `${parsed.year}-${String(parsed.month + 1).padStart(2, "0")}`
          }
          if (e.key === "ArrowLeft" && parsed.month > 1) {
            next = `${parsed.year}-${String(parsed.month - 1).padStart(2, "0")}`
          }
          if (e.key === "ArrowDown") {
            next = `${parsed.year - 1}-${String(parsed.month).padStart(2, "0")}`
          }
          if (e.key === "ArrowUp") {
            next = `${parsed.year + 1}-${String(parsed.month).padStart(2, "0")}`
          }
          if (next) {
            e.preventDefault()
            document.querySelector<HTMLElement>(`[data-period="${next}"]`)?.focus()
          }
        }}
        data-period={periodKey}
        onClick={() => {
          if (didDragRef.current) {
            didDragRef.current = false
            return
          }
          setMobileEditPeriod(periodKey)
        }}
      >
        {options?.showMonthShort && monthIdx >= 0 && (
          <span className="pointer-events-none absolute left-1 top-0.5 text-[9px] text-muted-foreground">
            {MONTHS[monthIdx]?.short}
          </span>
        )}
        <button
          type="button"
          data-edit-btn
          aria-label={`Edit ${label}`}
          className={`absolute right-0.5 top-0.5 rounded p-0.5 text-[#D4AF37] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${showEdit ? "opacity-100" : ""}`}
          onClick={(e) => {
            e.stopPropagation()
            onEditCell(periodKey, kind)
          }}
        >
          <Pencil className="h-3 w-3" aria-hidden />
        </button>
      </div>
    )
  }

  const displayYears = [scrollYear, scrollYear - 1, scrollYear - 2]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="calendar-year" className="text-sm text-muted-foreground">
          Scroll year
        </label>
        <select
          id="calendar-year"
          value={scrollYear}
          onChange={(e) => onScrollYearChange(Number(e.target.value))}
          className="rounded-lg border border-[#333] bg-[#1A1A1A] px-2 py-1 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {mode === "monthly" ? (
        <>
          {/* Mobile: quarter rows (3 months), no horizontal scroll */}
          <div className="flex flex-col gap-4 md:hidden" role="grid" aria-label="Income calendar by month">
            {displayYears.map((year) => (
              <div key={year} className="flex flex-col gap-2" role="rowgroup">
                <div className="text-xs font-semibold text-foreground" role="rowheader">
                  {year}
                </div>
                {QUARTER_MONTH_INDICES.map((quarter, qi) => (
                  <div key={`${year}-q${qi}`} role="row" className="grid grid-cols-3 gap-2">
                    {quarter.map((mi) => {
                      const pk = monthPeriodKey(year, mi)
                      return (
                        <div key={pk} className="flex min-w-0 flex-col gap-1">
                          <span className="text-center text-[10px] text-muted-foreground" role="columnheader">
                            {MONTHS[mi]!.short}
                          </span>
                          {renderCell(pk, "month", `${MONTHS[mi]!.full} ${year}`, { compact: true })}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Desktop: full year row, fit container width */}
          <div
            className="hidden w-full md:block"
            role="grid"
            aria-label="Income calendar by month"
          >
            <div className="grid w-full grid-cols-[2.5rem_repeat(12,minmax(0,1fr))] gap-1">
              <div />
              {MONTHS.map((m) => (
                <div
                  key={m.full}
                  className="min-w-0 truncate text-center text-[10px] leading-tight text-muted-foreground lg:text-xs"
                  role="columnheader"
                  title={m.full}
                >
                  <span className="lg:hidden">{m.short}</span>
                  <span className="hidden lg:inline">{m.full}</span>
                </div>
              ))}
              {displayYears.map((year) => (
                <div key={year} className="contents" role="row">
                  <div className="flex items-center text-xs font-medium text-muted-foreground" role="rowheader">
                    {year}
                  </div>
                  {MONTHS.map((_, mi) => {
                    const pk = monthPeriodKey(year, mi)
                    return renderCell(pk, "month", `${MONTHS[mi]!.full} ${year}`)
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div role="grid" aria-label="Income calendar by year" className="flex flex-col gap-2">
          {[scrollYear, scrollYear - 1, scrollYear - 2, scrollYear - 3, scrollYear - 4].map((year) => {
            const pk = String(year)
            const staged = entries.get(pk)
            const amount = staged?.amount ?? 0
            const intensity = heatmapIntensity(amount, heatmapMax)
            const visual = cellState({ periodKey: pk, tx0PeriodKey, amount, intensity })
            return (
              <div
                key={year}
                role="row"
                className={`flex items-center gap-3 rounded-xl p-3 touch-none ${cellClass(visual)}`}
                style={visual === "shaded" ? cellBackgroundStyle(intensity) : undefined}
                onPointerDown={() => applyPaint([pk], "year")}
              >
                <span className="w-16 text-sm font-medium">{year}</span>
                <span className="flex-1 text-xs text-muted-foreground">
                  {amount > 0 ? `$${amount.toFixed(2)} staged` : "Tap to paint annual income"}
                </span>
                <button
                  type="button"
                  className="text-[#D4AF37]"
                  aria-label={`Edit ${year}`}
                  onClick={() => onEditCell(pk, "year")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {focusPeriod && entries.has(focusPeriod) && (
        <p className="text-xs text-muted-foreground sr-only" aria-live="polite">
          Staged {entries.get(focusPeriod)!.amount} for {focusPeriod}
        </p>
      )}
    </div>
  )
}
