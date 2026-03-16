"use client"

import { useState, useEffect, useCallback, useRef } from "react"
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

export function WalkthroughOverlay() {
  const [currentStep, setCurrentStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
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
      if (step.target === "dashboard-area") {
        setTooltipPos({ top: 200, left: window.innerWidth / 2 })
      }
      return
    }
    const rect = el.getBoundingClientRect()
    if (step.position === "right") {
      setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 16 })
    } else {
      setTooltipPos({ top: rect.bottom + 16, left: rect.left + rect.width / 2 })
    }
  }, [currentStep])

  useEffect(() => {
    if (!visible) return
    positionTooltip()
    window.addEventListener("resize", positionTooltip)
    return () => window.removeEventListener("resize", positionTooltip)
  }, [visible, currentStep, positionTooltip])

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
          transform: step.position === "bottom" ? "translateX(-50%)" : "translateY(-50%)",
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
