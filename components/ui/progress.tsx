'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

function markerLeftStyle(markerPct: number): React.CSSProperties {
  const p = Math.max(0, Math.min(100, markerPct))
  // 1px line centered on p%; at edges use 0 / calc(100% - 1px) so it stays inside overflow clips.
  if (p <= 0) return { left: 0 }
  if (p >= 100) return { left: "calc(100% - 1px)" }
  return { left: `calc(${p}% - 0.5px)` }
}

function Progress({
  className,
  value,
  markerPct,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /** Optional 0-100 position for a vertical day-of-month marker line. */
  markerPct?: number
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full rounded-full bg-primary/20",
        className,
      )}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full w-full flex-1 transition-all"
          style={{
            transform: `translateX(-${100 - (value || 0)}%)`,
            backgroundColor: "var(--progress-color, var(--primary))",
          }}
        />
      </div>
      {markerPct !== undefined && (
        <div
          className="pointer-events-none absolute top-0 z-1 h-full w-px bg-white/70"
          style={markerLeftStyle(markerPct)}
          aria-hidden
        />
      )}
    </ProgressPrimitive.Root>
  )
}

export { Progress }
