"use client"

import { goalProgressRingColor } from "@/lib/savings-ui-metrics"

type Props = {
  progress: number
  /** When true, values above 100% show full ring with numeric label (e.g. 142%). */
  uncapped?: boolean
  size?: "md" | "lg"
  className?: string
}

export function GoalProgressRing({ progress, uncapped = false, size = "md", className }: Props) {
  const radius = size === "lg" ? 48 : 36
  const viewSize = size === "lg" ? 104 : 80
  const cx = viewSize / 2
  const displayPct = uncapped ? Math.max(0, progress) : Math.min(1, Math.max(0, progress))
  const ringFill = uncapped ? Math.min(1, displayPct) : displayPct
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - ringFill)
  const ringColor = goalProgressRingColor(uncapped ? Math.min(1, displayPct) : displayPct)
  const label = uncapped
    ? `${Math.round(displayPct * 100)}%`
    : `${Math.round(displayPct * 100)}%`
  const outerClass = size === "lg" ? "w-24 h-24" : "w-20 h-20"

  return (
    <div
      className={`relative shrink-0 ${outerClass} ${className ?? ""}`}
      aria-label={`Goal progress ${label}`}
    >
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${viewSize} ${viewSize}`}>
        <circle cx={cx} cy={cx} r={radius} fill="none" stroke="#1F1F1F" strokeWidth={6} />
        <circle
          cx={cx}
          cy={cx}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke] duration-300"
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-semibold ${
          size === "lg" ? "text-sm" : "text-xs"
        } ${displayPct <= 0 && !uncapped ? "text-muted-foreground" : "text-foreground"}`}
      >
        {label}
      </span>
    </div>
  )
}
