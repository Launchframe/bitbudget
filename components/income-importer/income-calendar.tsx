"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Pencil } from "lucide-react"
import type { IncomeImportEntry } from "@/lib/income-import"
import { isImportPeriodFuture, parseIncomePeriodKey } from "@/lib/income-import"
import {
  buildCalendarYears,
  cellState,
  heatmapIntensity,
  maxStagedAmount,
  monthsInRangeChronological,
  type CellVisualState,
} from "@/lib/income-import-calendar"
import { cellBackgroundStyle, editIconClassForHeatmap } from "@/components/income-importer/legend"

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
    case "future":
      return "border border-[#2A2A2A] bg-[#141414] opacity-40 cursor-not-allowed"
    case "shaded":
      return "border border-[#D4AF37]/50"
    default:
      return "border border-[#333] bg-[#1A1A1A] hover:border-[#555]"
  }
}

const ANNUAL_YEAR_FLOOR = 1900
const ANNUAL_INITIAL_SPAN = 24
const ANNUAL_LOAD_CHUNK = 12

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
  const [rovingPeriod, setRovingPeriod] = useState(() => monthPeriodKey(scrollYear, 0))
  const annualScrollRef = useRef<HTMLDivElement>(null)
  const annualTopSentinelRef = useRef<HTMLDivElement>(null)
  const annualBottomSentinelRef = useRef<HTMLDivElement>(null)
  const annualScrollAnchorRef = useRef<number | null>(null)
  const currentYear = useMemo(() => new Date().getUTCFullYear(), [])
  const annualViewKey = mode === "annual" ? `${scrollYear}:${currentYear}` : null
  const [annualRange, setAnnualRange] = useState(() => ({
    end: currentYear,
    start: Math.max(ANNUAL_YEAR_FLOOR, currentYear - ANNUAL_INITIAL_SPAN + 1),
  }))
  const [lastAnnualViewKey, setLastAnnualViewKey] = useState<string | null>(null)

  if (annualViewKey !== null && annualViewKey !== lastAnnualViewKey) {
    const minStart = Math.max(ANNUAL_YEAR_FLOOR, currentYear - ANNUAL_INITIAL_SPAN + 1)
    setLastAnnualViewKey(annualViewKey)
    setAnnualRange((prev) => ({
      end: currentYear,
      start: Math.min(prev.start, minStart),
    }))
  }

  useEffect(() => {
    if (mode !== "annual") return
    requestAnimationFrame(() => {
      annualScrollRef.current
        ?.querySelector<HTMLElement>(`[data-annual-year="${Math.min(scrollYear, currentYear)}"]`)
        ?.scrollIntoView({ block: "center" })
    })
  }, [mode, scrollYear, currentYear])

  const annualYears = useMemo(() => {
    const years: number[] = []
    for (let y = annualRange.end; y >= annualRange.start; y--) years.push(y)
    return years
  }, [annualRange.end, annualRange.start])
  const annualRangeRef = useRef(annualRange)

  useEffect(() => {
    annualRangeRef.current = annualRange
  }, [annualRange])

  useEffect(() => {
    if (mode !== "annual") return
    const root = annualScrollRef.current
    const top = annualTopSentinelRef.current
    const bottom = annualBottomSentinelRef.current
    if (!root || !top || !bottom) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const prev = annualRangeRef.current
          if (entry.target === top && prev.end < currentYear) {
            annualScrollAnchorRef.current = root.scrollHeight
            setAnnualRange((range) => ({
              ...range,
              end: Math.min(currentYear, range.end + ANNUAL_LOAD_CHUNK),
            }))
          }
          if (entry.target === bottom && prev.start > ANNUAL_YEAR_FLOOR) {
            setAnnualRange((range) => ({
              end: range.end,
              start: Math.max(ANNUAL_YEAR_FLOOR, range.start - ANNUAL_LOAD_CHUNK),
            }))
          }
        }
      },
      { root, rootMargin: "80px" },
    )

    observer.observe(top)
    observer.observe(bottom)
    return () => observer.disconnect()
  }, [mode, currentYear])

  useLayoutEffect(() => {
    if (mode !== "annual") return
    const root = annualScrollRef.current
    const anchor = annualScrollAnchorRef.current
    if (!root || anchor == null) return
    root.scrollTop += root.scrollHeight - anchor
    annualScrollAnchorRef.current = null
  }, [mode, annualRange.end])

  useEffect(() => {
    const next = mode === "monthly" ? monthPeriodKey(scrollYear, 0) : String(scrollYear)
    requestAnimationFrame(() => setRovingPeriod(next))
  }, [mode, scrollYear])

  const focusPeriodCell = useCallback((periodKey: string) => {
    const el = document.querySelector<HTMLElement>(`[data-period="${periodKey}"]`)
    if (!el) return
    setRovingPeriod(periodKey)
    setFocusPeriod(periodKey)
    requestAnimationFrame(() => {
      el.focus()
    })
  }, [])

  const stagedAmounts = useMemo(() => [...entries.values()].map((e) => e.amount), [entries])
  const heatmapMax = useMemo(() => maxStagedAmount(stagedAmounts), [stagedAmounts])

  const applyPaint = useCallback(
    (periodKeys: string[], kind: "month" | "year") => {
      if (paintAmount <= 0) return
      const importable = periodKeys.filter((periodKey) => !isImportPeriodFuture(periodKey))
      if (importable.length === 0) return
      const source = paintSource.trim() || undefined
      onStageEntries(
        importable.map((periodKey) => ({
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

  const clearCell = useCallback(
    (periodKey: string, kind: "month" | "year") => {
      if (isImportPeriodFuture(periodKey)) return
      if (!entries.has(periodKey)) return
      onStageEntries([{ periodKey, amount: 0, kind }])
    },
    [entries, onStageEntries],
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
    if (isImportPeriodFuture(periodKey)) return
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
    if (isImportPeriodFuture(periodKey)) return
    dragEndRef.current = periodKey
    if (periodKey !== dragStartRef.current) didDragRef.current = true
  }

  const displayYears = useMemo(
    () => [scrollYear, scrollYear - 1, scrollYear - 2],
    [scrollYear],
  )
  const visibleYearSet = useMemo(() => new Set(displayYears), [displayYears])

  const renderCell = (
    periodKey: string,
    kind: "month" | "year",
    label: string,
    options?: { compact?: boolean; showMonthShort?: boolean },
  ) => {
    const staged = entries.get(periodKey)
    const amount = staged?.amount ?? 0
    const intensity = heatmapIntensity(amount, heatmapMax)
    const visual = cellState({ periodKey, tx0PeriodKey, amount })
    const isFuture = visual === "future"
    const showEdit = mobileEditPeriod === periodKey
    const monthIdx = kind === "month" ? parseInt(periodKey.split("-")[1]!, 10) - 1 : -1

    return (
      <div
        key={periodKey}
        role="gridcell"
        tabIndex={isFuture ? -1 : rovingPeriod === periodKey ? 0 : -1}
        aria-disabled={isFuture || undefined}
        aria-label={`${label}${isFuture ? ", not importable yet" : amount > 0 ? `, staged ${amount} dollars` : ""}`}
        className={`relative w-full rounded-md touch-none ${options?.compact ? "min-h-10" : "aspect-square min-h-8"} ${cellClass(visual)} ${isFuture ? "" : "group focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/60"}`}
        style={visual === "shaded" ? cellBackgroundStyle(intensity) : undefined}
        onPointerDown={(e) => {
          if (isFuture) return
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest("[data-edit-btn]")) return
          if (kind === "month") {
            beginMonthDrag(periodKey, e.shiftKey)
            return
          }
          applyPaint([periodKey], "year")
          onLastClickedPeriodChange(periodKey)
        }}
        onContextMenu={(e) => {
          if (isFuture) return
          e.preventDefault()
          clearCell(periodKey, kind)
        }}
        onPointerEnter={() => {
          if (isFuture) return
          if (kind === "month") updateMonthDrag(periodKey)
        }}
        onFocus={() => {
          if (isFuture) return
          setFocusPeriod(periodKey)
          setRovingPeriod(periodKey)
        }}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (isFuture) return
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
            const nextParsed = parseIncomePeriodKey(next)
            if (
              !nextParsed ||
              nextParsed.kind !== "month" ||
              !visibleYearSet.has(nextParsed.year) ||
              isImportPeriodFuture(next)
            ) {
              return
            }
            e.preventDefault()
            focusPeriodCell(next)
          }
        }}
        data-period={periodKey}
        onClick={() => {
          if (isFuture) return
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
        {!isFuture && (
          <button
            type="button"
            data-edit-btn
            aria-label={`Edit ${label}`}
            className={`absolute right-0.5 top-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${showEdit ? "opacity-100" : ""} ${
              visual === "shaded" ? editIconClassForHeatmap(intensity) : "text-[#D4AF37]"
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onEditCell(periodKey, kind)
            }}
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {mode === "monthly" && (
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
      )}

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
        <div
          ref={annualScrollRef}
          role="grid"
          aria-label="Income calendar by year"
          className="flex max-h-[min(50vh,24rem)] flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl border border-[#1F1F1F] p-2"
        >
          <div ref={annualTopSentinelRef} className="h-px shrink-0" aria-hidden />
          {annualYears.map((year) => {
            const pk = String(year)
            const staged = entries.get(pk)
            const amount = staged?.amount ?? 0
            const intensity = heatmapIntensity(amount, heatmapMax)
            const visual = cellState({ periodKey: pk, tx0PeriodKey, amount })
            return (
              <div
                key={year}
                data-annual-year={year}
                role="row"
                className={`flex shrink-0 items-center gap-3 rounded-xl p-3 touch-none ${cellClass(visual)}`}
                style={visual === "shaded" ? cellBackgroundStyle(intensity) : undefined}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  if ((e.target as HTMLElement).closest("[data-edit-btn]")) return
                  applyPaint([pk], "year")
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  clearCell(pk, "year")
                }}
              >
                <span className="w-16 text-sm font-medium">{year}</span>
                <span className="flex-1 text-xs text-muted-foreground">
                  {amount > 0 ? `$${amount.toFixed(2)} staged` : "Tap to paint annual income"}
                </span>
                <button
                  type="button"
                  data-edit-btn
                  className={`rounded p-0.5 ${
                    visual === "shaded" ? editIconClassForHeatmap(intensity) : "text-[#D4AF37]"
                  }`}
                  aria-label={`Edit ${year}`}
                  onClick={() => onEditCell(pk, "year")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )
          })}
          <div ref={annualBottomSentinelRef} className="h-px shrink-0" aria-hidden />
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
