"use client"

import { PiggyBank } from "lucide-react"
import { formatUsd } from "@/lib/data"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"

export interface AllocationBarSegment {
  id: string
  name: string
  color: string
  icon: string | null | undefined
  value: number
}

export function AllocationStackedBar({
  envelopes,
  savingsValue,
  totalValue,
  onSegmentClick,
  variant = "single",
}: {
  envelopes: AllocationBarSegment[]
  savingsValue: number
  totalValue: number
  onSegmentClick?: (envelopeId: string) => void
  variant?: "single" | "before" | "after"
}) {
  const label =
    variant === "before" ? "Before" : variant === "after" ? "After" : null
  const denom = totalValue > 0 ? totalValue : 1

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      ) : null}
      <div className="flex h-10 rounded-xl overflow-hidden bg-[#1A1A1A] min-w-0">
        {envelopes.map((env) => {
          if (env.value <= 0) return null
          const pct = (env.value / denom) * 100
          const inner = (
            <div
              className={`flex items-center justify-center h-full ${
                onSegmentClick ? "hover:brightness-110 cursor-pointer" : ""
              }`}
              style={{
                flex: `${env.value} 0 0px`,
                backgroundColor: env.color,
                minWidth: 4,
              }}
              title={`${env.name}: ${formatUsd(env.value)} (${Math.round(pct)}%)`}
            >
              {pct > 8 ? (
                <EnvelopeIconDisplay
                  icon={env.icon}
                  fallbackName={env.name}
                  className="h-4 w-4 text-[10px] text-[#0D0D0D]/70"
                />
              ) : null}
            </div>
          )
          return onSegmentClick ? (
            <button
              key={env.id}
              type="button"
              className="h-full min-w-0"
              style={{ flex: `${env.value} 0 0px` }}
              onClick={() => onSegmentClick(env.id)}
              aria-label={`${env.name}, ${formatUsd(env.value)}`}
            >
              {inner}
            </button>
          ) : (
            <div key={env.id} className="h-full min-w-0" style={{ flex: `${env.value} 0 0px` }}>
              {inner}
            </div>
          )
        })}
        {savingsValue > 0 ? (
          <div
            className="flex items-center justify-center h-full"
            style={{
              flex: `${savingsValue} 0 0px`,
              backgroundColor: "rgba(34, 197, 94, 0.25)",
              minWidth: 4,
            }}
            title={`Savings: ${formatUsd(savingsValue)}`}
          >
            {(savingsValue / denom) * 100 > 8 ? (
              <PiggyBank className="h-4 w-4 text-[#22C55E]/60" aria-hidden />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
