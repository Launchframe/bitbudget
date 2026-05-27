"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"
import { buildSavingsGoalsWalkthroughSlides } from "@/lib/savings-goals-walkthrough-slides"
import { SavingsGoalsWalkthroughHero } from "@/components/savings-goals-walkthrough-heroes"
import { SuccessParticles } from "@/components/success-particles"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

const CELEBRATION_AUTO_CLOSE_MS = 2500

interface SavingsGoalsWalkthroughDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SavingsGoalsWalkthroughDialog({
  open,
  onOpenChange,
}: SavingsGoalsWalkthroughDialogProps) {
  const { state } = useApp()
  const slides = useMemo(() => buildSavingsGoalsWalkthroughSlides(), [])
  const [step, setStep] = useState(0)
  const [celebrating, setCelebrating] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const resetState = useCallback(() => {
    clearCloseTimer()
    setStep(0)
    setCelebrating(false)
  }, [clearCloseTimer])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetState()
      onOpenChange(next)
    },
    [onOpenChange, resetState],
  )

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

  const slide = slides[step]
  const isLastSlide = step === slides.length - 1
  const isFirstSlide = step === 0

  const startCelebration = () => {
    setCelebrating(true)
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      handleOpenChange(false)
    }, CELEBRATION_AUTO_CLOSE_MS)
  }

  if (!slide && !celebrating) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[min(96vw,28rem)] border-[#1F1F1F] bg-[#0D0D0D] text-foreground gap-0 p-0 overflow-hidden">
        {celebrating && (
          <SuccessParticles opportunityCostEnabled={state.opportunityCostEnabled} />
        )}
        <DialogHeader className="px-6 pt-6 pb-2 pr-12">
          <DialogTitle className="text-lg font-bold text-foreground">
            How savings goals work
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 px-6 py-4 text-center min-h-[280px] justify-center">
          {celebrating ? (
            <div aria-live="polite" className="flex flex-col items-center gap-3 py-4">
              <SavingsGoalsWalkthroughHero slideId="ready" />
              <p className="text-lg font-semibold text-foreground">Let&apos;s go!</p>
              <p className="text-sm text-muted-foreground">You&apos;re ready to build your savings streak.</p>
            </div>
          ) : (
            <>
              <SavingsGoalsWalkthroughHero slideId={slide.id} />
              <div className="space-y-2 max-w-sm" aria-live="polite">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {step + 1} of {slides.length}
                </p>
                <h3 className="text-base font-semibold text-foreground leading-snug">{slide.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{slide.body}</p>
              </div>
              <div className="flex items-center gap-1.5 pt-1" aria-hidden>
                {slides.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step ? "w-4" : "w-1.5"
                    }`}
                    style={{
                      backgroundColor: i === step ? SAVINGS_GOLD_ACCENT : "#333",
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {!celebrating && (
          <div className="flex gap-3 border-t border-[#1F1F1F] px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-[#333] bg-[#1A1A1A] hover:bg-[#222]"
              disabled={isFirstSlide}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>
            {isLastSlide ? (
              <Button
                type="button"
                className="flex-1 text-[#0D0D0D] hover:opacity-90"
                style={{ backgroundColor: SAVINGS_GOLD_ACCENT }}
                onClick={startCelebration}
              >
                Yes
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1 text-[#0D0D0D] hover:opacity-90"
                style={{ backgroundColor: SAVINGS_GOLD_ACCENT }}
                onClick={() => setStep((s) => Math.min(slides.length - 1, s + 1))}
              >
                Next
              </Button>
            )}
          </div>
        )}

        {celebrating && (
          <div className="flex border-t border-[#1F1F1F] px-6 py-4">
            <Button
              type="button"
              className="w-full text-[#0D0D0D] hover:opacity-90"
              style={{ backgroundColor: SAVINGS_GOLD_ACCENT }}
              onClick={() => handleOpenChange(false)}
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
