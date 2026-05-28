"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react"
import { MapPin, RotateCcw, X } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"
import {
  buildWalkthroughSteps,
  type WalkthroughStepDef,
} from "@/lib/walkthrough-steps"
import { findWalkthroughTarget } from "@/lib/walkthrough-target"

const EST_TOOLTIP_W = 300
const EST_TOOLTIP_H = 200
const VIEW_PAD = 12
const NAV_SETTLE_MS = 200

type TooltipVariant = "right" | "below" | "above"

type OverlayMode =
  | "tooltip"    // normal: backdrop + tooltip card
  | "spotlight"  // SVG cutout + click-catcher; user must tap the spotlighted element
  | "watching"   // no UI; wait for a dialog/sheet to close, then advance

interface TooltipPos {
  top: number
  left: number
  centred: boolean
  variant: TooltipVariant
}

interface SpotlightRect {
  x: number
  y: number
  w: number
  h: number
}

export function WalkthroughOverlay() {
  const {
    state,
    completeWalkthrough,
    restartWalkthrough,
    navigateTo,
    currentPage,
    pendingCount,
    hasPremiumFeatures,
    openNewTransaction,
    transactionDialogOpen,
    inputModeSheetOpen,
    setInputModeSheetOpen,
  } = useApp()

  const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false

  const steps = useMemo(
    () =>
      buildWalkthroughSteps({
        opportunityCostEnabled: state.opportunityCostEnabled,
        savingsEngaged: state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED,
        hasPremiumFeatures,
        pendingCount,
        isMobile,
      }),
    [
      state.opportunityCostEnabled,
      state.savingsExperience,
      hasPremiumFeatures,
      pendingCount,
      isMobile,
    ],
  )

  const [currentStep, setCurrentStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("tooltip")
  const [showEndHint, setShowEndHint] = useState(false)

  // Tooltip positioning
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({
    top: 0,
    left: 0,
    centred: false,
    variant: "right",
  })
  // Content fade
  const [contentVisible, setContentVisible] = useState(true)
  // Spotlight rect
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null)

  const tooltipRef = useRef<HTMLDivElement>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transitionReadyRafRef = useRef<number | null>(null)
  // Skip CSS position transition on first placement
  const positionedOnce = useRef(false)
  const [hasPositioned, setHasPositioned] = useState(false)

  const step: WalkthroughStepDef | undefined = steps[currentStep]
  const isLast = currentStep >= steps.length - 1

  const clearTransitionReadyRaf = useCallback(() => {
    if (transitionReadyRafRef.current === null) return
    cancelAnimationFrame(transitionReadyRafRef.current)
    transitionReadyRafRef.current = null
  }, [])

  // ─── Reset & show on walkthroughCompleted change ────────────────────────────
  useEffect(() => {
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      setVisible(false)
      setCurrentStep(0)
      setOverlayMode("tooltip")
      clearTransitionReadyRaf()
      positionedOnce.current = false
      setHasPositioned(false)
      if (!state.walkthroughCompleted) {
        setShowEndHint(false)
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
  }, [state.walkthroughCompleted, clearTransitionReadyRaf])

  const markPositioned = useCallback(() => {
    if (positionedOnce.current) return
    positionedOnce.current = true
    if (transitionReadyRafRef.current !== null) {
      cancelAnimationFrame(transitionReadyRafRef.current)
    }
    transitionReadyRafRef.current = requestAnimationFrame(() => {
      transitionReadyRafRef.current = null
      setHasPositioned(true)
    })
  }, [])

  // ─── Navigate to step page & fire settings tab event ───────────────────────
  useEffect(() => {
    if (!visible || !step) return
    if (overlayMode === "watching") return
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
  }, [visible, currentStep, step, currentPage, navigateTo, overlayMode])

  // ─── Position tooltip ────────────────────────────────────────────────────────
  const positionTooltip = useCallback(() => {
    if (!step) return
    const el = findWalkthroughTarget(step.target)
    const vh = window.innerHeight
    const vw = window.innerWidth

    if (!el) {
      const cx = vw / 2
      if (
        step.target === "new-transaction" ||
        step.target === "scan-receipt" ||
        step.target === "transaction-mode-btn"
      ) {
        setTooltipPos({ top: vh - 200, left: cx, centred: true, variant: "above" })
      } else if (
        step.target === "dashboard-metrics" ||
        step.target === "dashboard-chart"
      ) {
        setTooltipPos({ top: 160, left: cx, centred: true, variant: "below" })
      } else {
        setTooltipPos({ top: vh / 2 - 80, left: cx, centred: true, variant: "above" })
      }
      markPositioned()
      return
    }

    const rect = el.getBoundingClientRect()
    const anchorInBottomChrome = rect.top > vh * 0.55

    if (step.position === "right" && !anchorInBottomChrome) {
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
      markPositioned()
      return
    }

    const anchorX = rect.left + rect.width / 2
    const anchorY = anchorInBottomChrome
      ? rect.top
      : rect.top + Math.min(96, Math.max(48, rect.height * 0.12))

    const measured = tooltipRef.current?.getBoundingClientRect()
    const tipH = measured?.height ?? EST_TOOLTIP_H
    const tipW = measured?.width ?? EST_TOOLTIP_W

    const spaceBelow = vh - anchorY - VIEW_PAD
    const spaceAbove = anchorY - VIEW_PAD
    const preferBelow =
      !anchorInBottomChrome && (spaceBelow >= tipH || spaceBelow >= spaceAbove)

    let variant: TooltipVariant = preferBelow ? "below" : "above"
    let top = preferBelow ? anchorY + VIEW_PAD : anchorY - VIEW_PAD

    if (preferBelow && top + tipH > vh - VIEW_PAD) {
      variant = "above"
      top = anchorY - VIEW_PAD
    } else if (!preferBelow && top - tipH < VIEW_PAD) {
      variant = "below"
      top = anchorY + VIEW_PAD
    }

    // Clamp tooltip so it never clips the bottom of the screen (fixes iPhone 12 bug)
    if (variant === "below") {
      top = Math.min(top, vh - VIEW_PAD - tipH - 20)
    } else if (variant === "above") {
      top = Math.max(top, VIEW_PAD + tipH + 20)
    }

    let left = anchorX
    left = Math.max(VIEW_PAD + tipW / 2, Math.min(vw - VIEW_PAD - tipW / 2, left))

    setTooltipPos({ top, left, centred: false, variant })
    markPositioned()
  }, [step, markPositioned])

  // ─── Reposition after navigation / step change ──────────────────────────────
  useLayoutEffect(() => {
    if (!visible || !step || overlayMode === "spotlight" || overlayMode === "watching") return
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
  }, [visible, currentStep, currentPage, positionTooltip, step, overlayMode])

  useEffect(() => {
    if (!visible) return
    window.addEventListener("resize", positionTooltip)
    return () => window.removeEventListener("resize", positionTooltip)
  }, [visible, positionTooltip])

  // ─── Compute spotlight rect ─────────────────────────────────────────────────
  const computeSpotlightRect = useCallback(() => {
    if (!step) {
      setSpotlightRect(null)
      return
    }
    const target = step.spotlight ? step.target : null
    if (!target) {
      setSpotlightRect(null)
      return
    }
    const el = findWalkthroughTarget(target)
    if (!el) {
      setSpotlightRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setSpotlightRect({ x: r.left, y: r.top, w: r.width, h: r.height })
  }, [step])

  useEffect(() => {
    if (overlayMode !== "spotlight") return
    const raf = requestAnimationFrame(() => computeSpotlightRect())
    window.addEventListener("resize", computeSpotlightRect)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", computeSpotlightRect)
    }
  }, [overlayMode, computeSpotlightRect])

  // ─── Content fade transition helper ─────────────────────────────────────────
  const fadeAndChangeStep = useCallback((newStep: number) => {
    setContentVisible(false)
    setTimeout(() => {
      setCurrentStep(newStep)
      clearTransitionReadyRaf()
      positionedOnce.current = false
      setHasPositioned(false)
      setContentVisible(true)
    }, 120)
  }, [clearTransitionReadyRaf])

  // ─── Advance step (shared) ──────────────────────────────────────────────────
  const advanceStep = useCallback(() => {
    const nextIdx = currentStep + 1
    if (nextIdx >= steps.length) {
      setVisible(false)
      setOverlayMode("tooltip")
      void completeWalkthrough()
      setShowEndHint(true)
      endHintTimerRef.current = setTimeout(() => setShowEndHint(false), 8000)
      return
    }

    const nextStep = steps[nextIdx]

    // If the next step is an awaitClose step and the overlay is already open, show tooltip above it
    if (nextStep.awaitClose) {
      const isAlreadyOpen =
        (nextStep.awaitClose === "new-transaction-dialog" && transactionDialogOpen) ||
        (nextStep.awaitClose === "input-mode-sheet" && inputModeSheetOpen)
      if (isAlreadyOpen) {
        setOverlayMode("tooltip")
        fadeAndChangeStep(nextIdx)
        return
      }
    }

    setOverlayMode("tooltip")
    fadeAndChangeStep(nextIdx)
  }, [currentStep, steps, completeWalkthrough, fadeAndChangeStep, transactionDialogOpen, inputModeSheetOpen])

  // ─── Watch for dialog/sheet close ("watching" mode or tooltip-over-dialog) ──
  // Advances the step whenever the watched overlay closes.
  // Handles two cases:
  //   "watching": user clicked "Explore it — I'll wait" and the tooltip is hidden
  //   "tooltip":  tooltip is showing above the dialog; dialog closes before user clicks Next
  useEffect(() => {
    if (!visible || !step?.awaitClose) return
    const isActive =
      overlayMode === "watching" || overlayMode === "tooltip"
    if (!isActive) return

    const target = step.awaitClose
    const isClosed =
      (target === "new-transaction-dialog" && !transactionDialogOpen) ||
      (target === "input-mode-sheet" && !inputModeSheetOpen)

    if (!isClosed) return
    const t = setTimeout(() => advanceStep(), 0)
    return () => clearTimeout(t)
  }, [visible, overlayMode, step, transactionDialogOpen, inputModeSheetOpen, advanceStep])

  // ─── Handle Next button click ────────────────────────────────────────────────
  function handleNext() {
    if (!step) return

    // If this step has a spotlight, enter spotlight mode instead of advancing
    if (step.spotlight) {
      computeSpotlightRect()
      setOverlayMode("spotlight")
      return
    }

    // If this step has awaitClose, clicking Next hides the tooltip (enter watching)
    if (step.awaitClose) {
      setOverlayMode("watching")
      return
    }

    // closeOnAdvance: close the target overlay before advancing
    if (step.closeOnAdvance === "input-mode-sheet") {
      setInputModeSheetOpen(false)
    }

    if (currentStep < steps.length - 1) {
      advanceStep()
    } else {
      dismiss()
    }
  }

  function handleBack() {
    if (currentStep <= 0) return
    setOverlayMode("tooltip")
    clearTransitionReadyRaf()
    positionedOnce.current = false
    setHasPositioned(false)
    setCurrentStep(currentStep - 1)
  }

  function dismiss() {
    setVisible(false)
    setOverlayMode("tooltip")
    setShowEndHint(false)
    void completeWalkthrough()
    setShowEndHint(true)
    endHintTimerRef.current = setTimeout(() => setShowEndHint(false), 8000)
  }

  // ─── Spotlight click handler ─────────────────────────────────────────────────
  function handleSpotlightActivate() {
    if (!step?.spotlight) return
    const { action, prefill } = step.spotlight

    if (action === "open-new-transaction") {
      openNewTransaction(prefill)
    } else if (action === "open-input-mode-sheet") {
      setInputModeSheetOpen(true)
    }

    // Move to the next step; advanceStep handles all branching
    advanceStep()
  }

  function handleSpotlightKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    handleSpotlightActivate()
  }

  // ─── Tour end hint auto-dismiss cleanup ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (endHintTimerRef.current) clearTimeout(endHintTimerRef.current)
      clearTransitionReadyRaf()
    }
  }, [clearTransitionReadyRaf])

  // ─── Nothing to render ───────────────────────────────────────────────────────
  if (state.walkthroughCompleted && !showEndHint) return null
  if (!visible && !showEndHint) return null

  // ─── Tour-end hint ──────────────────────────────────────────────────────────
  if (showEndHint && !visible) {
    return (
      <div className="fixed inset-0 z-70 pointer-events-none flex items-end justify-center pb-24 px-4">
        <div
          className="pointer-events-auto bg-[#1A1A1A] border border-[#333] rounded-2xl p-5 shadow-2xl max-w-sm w-full animate-in slide-in-from-bottom-4 fade-in duration-300"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground mb-1">Tour complete</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Find it again any time in{" "}
                <span className="text-foreground">Settings → App tour</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowEndHint(false)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => {
                setShowEndHint(false)
                void restartWalkthrough()
              }}
              className="flex items-center gap-2 text-xs font-medium text-btc-orange hover:text-btc-orange/80 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Replay tour
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!step) return null

  // ─── Determine z-index context ──────────────────────────────────────────────
  // When waiting alongside an open dialog/sheet, use a higher z than the dialog (z-50 → z-[60])
  const isAwaitingOpen =
    step.awaitClose &&
    ((step.awaitClose === "new-transaction-dialog" && transactionDialogOpen) ||
      (step.awaitClose === "input-mode-sheet" && inputModeSheetOpen))
  const rootZ = isAwaitingOpen ? "z-[60]" : "z-50"

  // ─── Tooltip transform ───────────────────────────────────────────────────────
  const tooltipTransform = tooltipPos.centred
    ? "translate(-50%, -50%)"
    : tooltipPos.variant === "below"
      ? "translateX(-50%)"
      : tooltipPos.variant === "above"
        ? "translate(-50%, -100%)"
        : "translateY(-50%)"

  // ─── Spotlight mode ──────────────────────────────────────────────────────────
  if (overlayMode === "spotlight") {
    const pad = 10
    const r = spotlightRect
    const vw = typeof window !== "undefined" ? window.innerWidth : 390
    const vh = typeof window !== "undefined" ? window.innerHeight : 844

    // Position the "tap here" label below (or above if near bottom)
    const labelY = r
      ? r.y + r.h + pad + 8 > vh - 60
        ? r.y - pad - 36
        : r.y + r.h + pad + 8
      : vh / 2
    const labelX = r ? r.x + r.w / 2 : vw / 2

    return (
      <div
        className="fixed inset-0 z-55"
        role="dialog"
        aria-modal="true"
        aria-label="Tour: interact with the highlighted element"
      >
        {/* SVG dimming mask with spotlight cutout */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ display: "block" }}
        >
          {r ? (
            <>
              <defs>
                <mask id="spotlight-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect
                    x={r.x - pad}
                    y={r.y - pad}
                    width={r.w + pad * 2}
                    height={r.h + pad * 2}
                    rx="14"
                    fill="black"
                  />
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="rgba(0,0,0,0.78)"
                mask="url(#spotlight-mask)"
              />
              {/* Spotlight border glow */}
              <rect
                x={r.x - pad}
                y={r.y - pad}
                width={r.w + pad * 2}
                height={r.h + pad * 2}
                rx="14"
                fill="none"
                stroke="#F7931A"
                strokeWidth="1.5"
                opacity="0.6"
              />
            </>
          ) : (
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.78)" />
          )}
        </svg>

        {/* Click-catcher over the spotlighted element */}
        {r && (
          <div
            className="absolute cursor-pointer"
            style={{
              left: r.x - pad,
              top: r.y - pad,
              width: r.w + pad * 2,
              height: r.h + pad * 2,
            }}
            onClick={handleSpotlightActivate}
            onKeyDown={handleSpotlightKeyDown}
            role="button"
            tabIndex={0}
            aria-label={step.spotlight?.prompt ?? "Activate"}
          />
        )}

        {/* Prompt label */}
        {step.spotlight && (
          <div
            className="absolute pointer-events-none flex items-center gap-1.5 text-xs font-medium text-btc-orange animate-in fade-in duration-300"
            style={{
              left: labelX,
              top: labelY,
              transform: "translateX(-50%)",
            }}
          >
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {step.spotlight.prompt}
          </div>
        )}

        {/* Skip button */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-4 right-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors bg-[#1A1A1A]/80 rounded-lg px-3 py-1.5 border border-[#333]"
        >
          <X className="h-3 w-3" aria-hidden />
          Skip tour
        </button>
      </div>
    )
  }

  // ─── Watching mode (no UI) ───────────────────────────────────────────────────
  if (overlayMode === "watching") return null

  // ─── Normal tooltip mode ─────────────────────────────────────────────────────
  const nextLabel = step.awaitClose
    ? "Explore it — I'll wait"
    : isLast
      ? "Got it!"
      : "Next"

  return (
    <div className={`fixed inset-0 ${rootZ}`}>
      {/* Backdrop — clicks are swallowed (no dismiss on backdrop click) */}
      {!isAwaitingOpen && (
        <div className="absolute inset-0 bg-black/50" aria-hidden />
      )}

      <div
        ref={(el) => {
          tooltipRef.current = el
        }}
        className="absolute bg-[#1A1A1A] border border-[#333] rounded-xl p-4 shadow-xl max-w-xs"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: tooltipTransform,
          // Skip CSS transition on first placement so the card doesn't fly in from (0,0)
          transition: hasPositioned
            ? "top 350ms cubic-bezier(0.4,0,0.2,1), left 350ms cubic-bezier(0.4,0,0.2,1)"
            : undefined,
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

        <div
          className="transition-opacity duration-100"
          style={{ opacity: contentVisible ? 1 : 0 }}
        >
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
                  className={`h-1.5 rounded-full transition-all duration-200 ${
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
                {nextLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
