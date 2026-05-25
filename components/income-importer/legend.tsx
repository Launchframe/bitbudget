"use client"

import type { CSSProperties } from "react"
import type { CellVisualState } from "@/lib/income-import-calendar"

const SWATCH: Record<CellVisualState, string> = {
  empty: "bg-[#1A1A1A] border border-[#333]",
  shaded: "border border-[#D4AF37]/40",
  tx0: "border-2 border-[#D4AF37] bg-[#1A1A1A]",
  preHistory: "bg-[#111] border border-[#222] opacity-50",
}

const LABELS: { state: CellVisualState; label: string }[] = [
  { state: "empty", label: "No import" },
  { state: "tx0", label: "First real transaction" },
  { state: "preHistory", label: "Before your history" },
]

export function IncomeImporterLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Calendar legend">
      {LABELS.map(({ state, label }) => (
        <div key={state} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${SWATCH[state]}`} aria-hidden />
          <span>{label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex h-3 w-16 overflow-hidden rounded-sm border border-[#D4AF37]/30"
          aria-hidden
        >
          <span className="h-full flex-1" style={heatmapLegendStyle(0.2)} />
          <span className="h-full flex-1" style={heatmapLegendStyle(0.55)} />
          <span className="h-full flex-1" style={heatmapLegendStyle(1)} />
        </span>
        <span>Staged income (lighter = less)</span>
      </div>
    </div>
  )
}

export function cellBackgroundStyle(intensity: number): CSSProperties | undefined {
  if (intensity <= 0) return undefined
  const t = Math.max(0, Math.min(1, intensity))
  // Spreadsheet-style conditional fill: dark base → warm wash → full savings gold at max
  const curved = Math.pow(t, 1.35)
  const base = { r: 26, g: 26, b: 26 }
  const wash = { r: 72, g: 68, b: 58 }
  const gold = { r: 212, g: 175, b: 55 }
  const mid = {
    r: wash.r + (gold.r - wash.r) * curved,
    g: wash.g + (gold.g - wash.g) * curved,
    b: wash.b + (gold.b - wash.b) * curved,
  }
  const r = Math.round(base.r + (mid.r - base.r) * t)
  const g = Math.round(base.g + (mid.g - base.g) * t)
  const b = Math.round(base.b + (mid.b - base.b) * t)
  return { backgroundColor: `rgb(${r}, ${g}, ${b})` }
}

export function heatmapLegendStyle(intensity: number): CSSProperties {
  return cellBackgroundStyle(intensity) ?? { backgroundColor: "#1A1A1A" }
}
