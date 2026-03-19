"use client"

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react"
import { X } from "lucide-react"

interface WalkthroughStep {
  target: string
  title: string
  description: string
  position: "right" | "bottom"
}

const STEPS: WalkthroughStep[] = [
  {
    target: "transactions",
    title: "Your Transactions",
    description: "This is where you'll add and manage your expenses.",
    position: "right",
  },
  {
    target: "new-transaction",
    title: "Add a Transaction",
    description: "Tap here to record your first expense.",
    position: "right",
  },
  {
    target: "dashboard-area",
    title: "Your Dashboard",
    description: "Spending insights and Bitcoin opportunity costs appear here once you have transactions.",
    position: "bottom",
  },
]

const STORAGE_KEY = "bitbudget-walkthrough-completed"

/** Estimated tooltip size for viewport clamping before/without layout measure */
const EST_TOOLTIP_W = 300
const EST_TOOLTIP_H = 200
const VIEW_PAD = 12

type TooltipVariant = "right" | "below" | "above"

export function WalkthroughOverlay() {
  const [currentStep, setCurrentStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{
    top: number
    left: number
    centred: boolean
    variant: TooltipVariant
  }>({ top: 0, left: 0, centred: false, variant: "right" })
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
    } catch { return }
    const timer = setTimeout(() => setVisible(true), 800)
    return () => clearTimeout(timer)
  }, [])

  const positionTooltip = useCallback(() => {
    const step = STEPS[currentStep]
    const el = document.querySelector(`[data-walkthrough="${step.target}"]`)
    if (!el) {
      // Fallback positions when the target element doesn't exist (e.g. on mobile where sidebar items are hidden)
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      if (step.target === "new-transaction") {
        setTooltipPos({ top: window.innerHeight - 180, left: cx, centred: true, variant: "above" })
      } else if (step.target === "dashboard-area") {
        setTooltipPos({ top: 200, left: cx, centred: true, variant: "above" })
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
      const left = rect.right + 16
      // Keep tooltip vertically in view (transform uses translateY(-50%))
      top = Math.max(
        VIEW_PAD + EST_TOOLTIP_H / 2,
        Math.min(vh - VIEW_PAD - EST_TOOLTIP_H / 2, top)
      )
      setTooltipPos({ top, left, centred: false, variant: "right" })
      return
    }

    // "bottom" step: dashboard-area wraps the whole column — rect.bottom is often below the fold.
    // Anchor near the top of the dashboard content, not below the full column height.
    const rawAnchorY = rect.top + Math.min(96, Math.max(48, rect.height * 0.12))
    // Keep anchor inside the viewport so the tooltip can always be placed on-screen.
    const anchorY = Math.max(
      VIEW_PAD + 80,
      Math.min(vh - VIEW_PAD - 80, rawAnchorY)
    )
    const anchorX = rect.left + rect.width / 2

    const measured = tooltipRef.current?.getBoundingClientRect()
    const tipH = measured?.height ?? EST_TOOLTIP_H
    const tipW = measured?.width ?? EST_TOOLTIP_W

    const spaceBelow = vh - anchorY - VIEW_PAD
    const spaceAbove = anchorY - VIEW_PAD
    const preferBelow = spaceBelow >= tipH || spaceBelow >= spaceAbove

    let variant: TooltipVariant = preferBelow ? "below" : "above"
    let top = preferBelow ? anchorY + VIEW_PAD : anchorY - VIEW_PAD

    // If still off-screen, flip
    if (preferBelow && top + tipH > vh - VIEW_PAD) {
      variant = "above"
      top = anchorY - VIEW_PAD
    } else if (!preferBelow && top - tipH < VIEW_PAD) {
      variant = "below"
      top = anchorY + VIEW_PAD
    }

    let left = anchorX
    left = Math.max(
      VIEW_PAD + tipW / 2,
      Math.min(vw - VIEW_PAD - tipW / 2, left)
    )

    setTooltipPos({ top, left, centred: false, variant })
  }, [currentStep])

  useLayoutEffect(() => {
    if (!visible) return
    // Defer setState to satisfy react-hooks/set-state-in-effect (avoid sync setState in effect body).
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      positionTooltip()
      raf2 = requestAnimationFrame(() => positionTooltip())
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [visible, currentStep, positionTooltip])

  useEffect(() => {
    if (!visible) return
    window.addEventListener("resize", positionTooltip)
    return () => window.removeEventListener("resize", positionTooltip)
  }, [visible, positionTooltip])

  function handleNext() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      dismiss()
    }
  }

  function dismiss() {
    setVisible(false)
    try { localStorage.setItem(STORAGE_KEY, "1") } catch {}
  }

  if (!visible) return null

  const step = STEPS[currentStep]
  const isLast = currentStep === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} />
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
          onClick={dismiss}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Skip walkthrough"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <h3 className="text-sm font-semibold text-foreground mb-1">{step.title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{step.description}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-colors ${
                  i === currentStep ? "w-4 bg-btc-orange" : "w-1.5 bg-[#333]"
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNext}
            className="text-xs font-medium text-btc-orange hover:text-btc-orange/80 transition-colors"
          >
            {isLast ? "Got it!" : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}
