"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { X } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"
import {
  buildWalkthroughSteps,
  type WalkthroughStepDef,
} from "@/lib/walkthrough-steps"

const LEGACY_STORAGE_KEY = "bitbudget-walkthrough-completed"
const EST_TOOLTIP_W = 300
const EST_TOOLTIP_H = 200
const VIEW_PAD = 12
const NAV_SETTLE_MS = 320

type TooltipVariant = "right" | "below" | "above"

export function WalkthroughOverlay() {
  const {
    state,
    completeWalkthrough,
    navigateTo,
    currentPage,
    pendingCount,
    hasPremiumFeatures,
  } = useApp()

  const steps = useMemo(
    () =>
      buildWalkthroughSteps({
        opportunityCostEnabled: state.opportunityCostEnabled,
        savingsEngaged: state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED,
        hasPremiumFeatures,
        pendingCount,
      }),
    [
      state.opportunityCostEnabled,
      state.savingsExperience,
      hasPremiumFeatures,
      pendingCount,
    ],
  )

  const [currentStep, setCurrentStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{
    top: number
    left: number
    centred: boolean
    variant: TooltipVariant
  }>({ top: 0, left: 0, centred: false, variant: "right" })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const step: WalkthroughStepDef | undefined = steps[currentStep]
  const isLast = currentStep >= steps.length - 1

  useEffect(() => {
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      setVisible(false)
      setCurrentStep(0)
      if (!state.walkthroughCompleted) {
        showTimerRef.current = setTimeout(() => {
          if (!cancelled) setVisible(true)
        }, 800)
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
    }
  }, [state.walkthroughCompleted])

  useEffect(() => {
    if (!visible || !step) return
    if (step.page !== currentPage) {
      navigateTo(step.page)
    }
    if (step.settingsTab && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("bitbudget-walkthrough-settings-tab", {
          detail: { tab: step.settingsTab },
        }),
      )
    }
  }, [visible, currentStep, step, currentPage, navigateTo])

  const positionTooltip = useCallback(() => {
    if (!step) return
    const el = document.querySelector(`[data-walkthrough="${step.target}"]`)
    if (!el) {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      if (step.target === "new-transaction" || step.target === "scan-receipt") {
        setTooltipPos({ top: window.innerHeight - 180, left: cx, centred: true, variant: "above" })
      } else if (step.target === "dashboard-metrics" || step.target === "dashboard-chart") {
        setTooltipPos({ top: 160, left: cx, centred: true, variant: "below" })
      } else {
        setTooltipPos({ top: cy - 80, left: cx, centred: true, variant: "above" })
      }
      return
    }
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (step.position === "right") {
      let top = rect.top + rect.height / 2
      let left = rect.right + 16
      top = Math.max(
        VIEW_PAD + EST_TOOLTIP_H / 2,
        Math.min(vh - VIEW_PAD - EST_TOOLTIP_H / 2, top),
      )
      const measured = tooltipRef.current?.getBoundingClientRect()
      const tipW = measured?.width ?? EST_TOOLTIP_W
      left = Math.max(VIEW_PAD, Math.min(vw - VIEW_PAD - tipW, left))
      setTooltipPos({ top, left, centred: false, variant: "right" })
      return
    }

    const rawAnchorY = rect.top + Math.min(96, Math.max(48, rect.height * 0.12))
    const anchorY = Math.max(VIEW_PAD + 80, Math.min(vh - VIEW_PAD - 80, rawAnchorY))
    const anchorX = rect.left + rect.width / 2

    const measured = tooltipRef.current?.getBoundingClientRect()
    const tipH = measured?.height ?? EST_TOOLTIP_H
    const tipW = measured?.width ?? EST_TOOLTIP_W

    const spaceBelow = vh - anchorY - VIEW_PAD
    const spaceAbove = anchorY - VIEW_PAD
    const preferBelow = spaceBelow >= tipH || spaceBelow >= spaceAbove

    let variant: TooltipVariant = preferBelow ? "below" : "above"
    let top = preferBelow ? anchorY + VIEW_PAD : anchorY - VIEW_PAD

    if (preferBelow && top + tipH > vh - VIEW_PAD) {
      variant = "above"
      top = anchorY - VIEW_PAD
    } else if (!preferBelow && top - tipH < VIEW_PAD) {
      variant = "below"
      top = anchorY + VIEW_PAD
    }

    let left = anchorX
    left = Math.max(VIEW_PAD + tipW / 2, Math.min(vw - VIEW_PAD - tipW / 2, left))

    setTooltipPos({ top, left, centred: false, variant })
  }, [step])

  useLayoutEffect(() => {
    if (!visible || !step) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current)
      navTimerRef.current = setTimeout(() => {
        positionTooltip()
        raf2 = requestAnimationFrame(() => positionTooltip())
      }, NAV_SETTLE_MS)
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      if (navTimerRef.current) {
        clearTimeout(navTimerRef.current)
        navTimerRef.current = null
      }
    }
  }, [visible, currentStep, currentPage, positionTooltip, step])

  useEffect(() => {
    if (!visible) return
    window.addEventListener("resize", positionTooltip)
    return () => window.removeEventListener("resize", positionTooltip)
  }, [visible, positionTooltip])

  function handleNext() {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      dismiss()
    }
  }

  function handleBack() {
    if (currentStep > 0) setCurrentStep(currentStep - 1)
  }

  function dismiss() {
    setVisible(false)
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    void completeWalkthrough()
  }

  if (!visible || state.walkthroughCompleted || !step) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden />
      <div
        ref={tooltipRef}
        className="absolute bg-[#1A1A1A] border border-[#333] rounded-xl p-4 shadow-xl max-w-xs z-50"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: tooltipPos.centred
            ? "translate(-50%, -50%)"
            : tooltipPos.variant === "below"
              ? "translateX(-50%)"
              : tooltipPos.variant === "above"
                ? "translate(-50%, -100%)"
                : "translateY(-50%)",
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Skip walkthrough"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Step {currentStep + 1} of {steps.length}
        </p>
        <h3 className="text-sm font-semibold text-foreground mb-1 pr-4">{step.title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{step.description}</p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-colors ${
                  i === currentStep ? "w-4 bg-btc-orange" : "w-1.5 bg-[#333]"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="text-xs font-medium text-btc-orange hover:text-btc-orange/80 transition-colors"
            >
              {isLast ? "Got it!" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
