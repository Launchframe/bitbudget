'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

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
        'bg-primary/20 relative h-2 w-full overflow-hidden rounded-full',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 transition-all"
        style={{
          transform: `translateX(-${100 - (value || 0)}%)`,
          backgroundColor: "var(--progress-color, var(--primary))",
        }}
      />
      {markerPct !== undefined && (
        <div
          className="absolute top-0 h-full w-px bg-white/70 pointer-events-none"
          style={{ left: `${Math.max(0, Math.min(100, markerPct))}%` }}
          aria-hidden
        />
      )}
    </ProgressPrimitive.Root>
  )
}

export { Progress }
