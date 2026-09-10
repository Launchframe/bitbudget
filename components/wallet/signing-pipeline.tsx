"use client"

import { CheckCircle2, Circle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type SigningStep = "auth" | "computing" | "broadcasting" | "done"

export interface SigningPipelineProps {
  currentStep: SigningStep | null
  error?: string | null
  className?: string
}

const STEPS: { id: SigningStep; label: string; sublabel: string }[] = [
  {
    id: "auth",
    label: "Authenticate",
    sublabel: "Device passkey verified",
  },
  {
    id: "computing",
    label: "Computing shards",
    sublabel: "MPC round in progress",
  },
  {
    id: "broadcasting",
    label: "Broadcasting",
    sublabel: "Sending to network",
  },
  {
    id: "done",
    label: "Complete",
    sublabel: "Transaction confirmed",
  },
]

const STEP_ORDER: SigningStep[] = ["auth", "computing", "broadcasting", "done"]

function stepIndex(step: SigningStep): number {
  return STEP_ORDER.indexOf(step)
}

export function SigningPipeline({
  currentStep,
  error,
  className,
}: SigningPipelineProps) {
  const currentIdx = currentStep ? stepIndex(currentStep) : -1

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-start gap-0 w-full">
        {STEPS.map((step, i) => {
          const sIdx = stepIndex(step.id)
          const isCompleted = currentIdx > sIdx
          const isActive = currentIdx === sIdx
          const isLast = i === STEPS.length - 1

          return (
            <div key={step.id} className="flex-1 flex flex-col items-center">
              <div className="flex items-center w-full">
                {/* Connector left */}
                {i > 0 && (
                  <div
                    className={cn(
                      "h-px flex-1 transition-colors duration-700",
                      isCompleted || isActive ? "bg-[#F7931A]" : "bg-white/10",
                    )}
                  />
                )}
                {/* Step circle */}
                <div
                  className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ring-2",
                    isCompleted
                      ? "bg-[#22C55E]/15 ring-[#22C55E] text-[#22C55E]"
                      : isActive
                        ? "bg-[#F7931A]/15 ring-[#F7931A] text-[#F7931A]"
                        : "bg-white/5 ring-white/10 text-white/30",
                  )}
                  aria-label={`${step.label}: ${isCompleted ? "done" : isActive ? "in progress" : "pending"}`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </div>
                {/* Connector right */}
                {!isLast && (
                  <div
                    className={cn(
                      "h-px flex-1 transition-colors duration-700",
                      isCompleted ? "bg-[#F7931A]" : "bg-white/10",
                    )}
                  />
                )}
              </div>
              {/* Labels */}
              <div className="mt-2 text-center px-1">
                <p
                  className={cn(
                    "text-xs font-medium transition-colors",
                    isCompleted
                      ? "text-[#22C55E]"
                      : isActive
                        ? "text-[#F7931A]"
                        : "text-white/30",
                  )}
                >
                  {step.label}
                </p>
                <p
                  className={cn(
                    "text-[10px] mt-0.5 hidden sm:block transition-colors",
                    isActive ? "text-muted-foreground" : "text-white/20",
                  )}
                >
                  {step.sublabel}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
