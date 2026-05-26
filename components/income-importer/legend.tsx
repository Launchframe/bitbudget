"use client"

import type { CSSProperties } from "react"
import type { CellVisualState } from "@/lib/income-import-calendar"

const SWATCH: Record<CellVisualState, string> = {
  empty: "bg-[#1A1A1A] border border-[#333]",
  shaded: "border border-[#D4AF37]/40",
  tx0: "border-2 border-[#D4AF37] bg-[#1A1A1A]",
  preHistory: "bg-[#111] border border-[#222] opacity-50",
  future: "bg-[#141414] border border-[#2A2A2A] opacity-40",
}

const LABELS: { state: CellVisualState; label: string }[] = [
  { state: "empty", label: "Not added yet" },
  { state: "tx0", label: "First real transaction" },
  { state: "preHistory", label: "Before your history" },
  { state: "future", label: "Not available yet" },
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
        <span>Income added (brighter = more)</span>
      </div>
    </div>
  )
}

function cellHeatmapRgb(intensity: number): { r: number; g: number; b: number } | null {
  if (intensity <= 0) return null
  const t = Math.max(0, Math.min(1, intensity))
  const curved = Math.pow(t, 1.35)
  const base = { r: 26, g: 26, b: 26 }
  const wash = { r: 72, g: 68, b: 58 }
  const gold = { r: 212, g: 175, b: 55 }
  const mid = {
    r: wash.r + (gold.r - wash.r) * curved,
    g: wash.g + (gold.g - wash.g) * curved,
    b: wash.b + (gold.b - wash.b) * curved,
  }
  return {
    r: Math.round(base.r + (mid.r - base.r) * t),
    g: Math.round(base.g + (mid.g - base.g) * t),
    b: Math.round(base.b + (mid.b - base.b) * t),
  }
}

export function cellBackgroundStyle(intensity: number): CSSProperties | undefined {
  const rgb = cellHeatmapRgb(intensity)
  if (!rgb) return undefined
  return { backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` }
}

/** Pencil icon classes that stay readable on heatmap-filled cells (dark on bright gold). */
export function editIconClassForHeatmap(intensity: number): string {
  const rgb = cellHeatmapRgb(intensity)
  if (!rgb) return "text-[#D4AF37]"
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  if (luminance > 0.45) {
    return "text-[#0D0D0D] bg-white/90 ring-1 ring-[#0D0D0D]/10"
  }
  return "text-[#D4AF37]"
}

export function heatmapLegendStyle(intensity: number): CSSProperties {
  return cellBackgroundStyle(intensity) ?? { backgroundColor: "#1A1A1A" }
}
