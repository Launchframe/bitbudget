"use client"

import { useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { ONBOARDING_ALLOCATE_FINE_STEP } from "@/lib/onboarding-allocate-budget"

const SWIPE_PX_PER_STEP = 10
const TAP_MOVE_THRESHOLD_PX = 8
/** Visible track height — keep in sync with inner `h-10`. */
const VISIBLE_TRACK_HEIGHT_PX = 40
/** Extra touch padding above/below the visible track (layout neutral via negative margin). */
const HIT_EXTEND_Y_PX = 16

type OnboardingAllocFineScrollerProps = {
  accentColor: string
  ariaLabel: string
  onGestureStart: () => void
  onNudge: (deltaSteps: number) => void
  onGestureEnd: () => void
}

export function OnboardingAllocFineScroller({
  accentColor,
  ariaLabel,
  onGestureStart,
  onNudge,
  onGestureEnd,
}: OnboardingAllocFineScrollerProps) {
  const hitRef = useRef<HTMLDivElement>(null)
  const [isPressed, setIsPressed] = useState(false)
  const pointerRef = useRef<{
    pointerId: number
    startY: number
    lastStepY: number
    swipeNudgeCount: number
  } | null>(null)

  const finishGesture = (pointerId: number, target: HTMLElement) => {
    if (pointerRef.current?.pointerId !== pointerId) return
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      /* noop */
    }
    pointerRef.current = null
    setIsPressed(false)
    onGestureEnd()
  }

  const nudgeFromTap = (clientY: number) => {
    const hit = hitRef.current
    if (!hit) return
    const rect = hit.getBoundingClientRect()
    if (rect.height <= 0) return
    const ratio = (clientY - rect.top) / rect.height
    if (ratio <= 0.5) {
      onNudge(1)
    } else {
      onNudge(-1)
    }
  }

  return (
    <div
      ref={hitRef}
      role="group"
      aria-label={ariaLabel}
      className="relative flex w-7 shrink-0 touch-none select-none items-center justify-center"
      style={{
        touchAction: "none",
        height: VISIBLE_TRACK_HEIGHT_PX + HIT_EXTEND_Y_PX * 2,
        marginTop: -HIT_EXTEND_Y_PX,
        marginBottom: -HIT_EXTEND_Y_PX,
      }}
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        setIsPressed(true)
        onGestureStart()
        pointerRef.current = {
          pointerId: e.pointerId,
          startY: e.clientY,
          lastStepY: e.clientY,
          swipeNudgeCount: 0,
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
      }}
      onPointerMove={e => {
        const session = pointerRef.current
        if (!session || session.pointerId !== e.pointerId) return
        e.stopPropagation()
        const delta = session.lastStepY - e.clientY
        if (Math.abs(delta) >= SWIPE_PX_PER_STEP) {
          const steps = Math.trunc(delta / SWIPE_PX_PER_STEP)
          if (steps !== 0) {
            onNudge(steps)
            session.swipeNudgeCount += Math.abs(steps)
            session.lastStepY -= steps * SWIPE_PX_PER_STEP
          }
        }
      }}
      onPointerUp={e => {
        const session = pointerRef.current
        if (!session || session.pointerId !== e.pointerId) return
        e.stopPropagation()
        const moved = Math.abs(e.clientY - session.startY)
        if (session.swipeNudgeCount === 0 && moved <= TAP_MOVE_THRESHOLD_PX) {
          nudgeFromTap(session.startY)
        }
        finishGesture(e.pointerId, e.currentTarget)
      }}
      onPointerCancel={e => {
        e.stopPropagation()
        finishGesture(e.pointerId, e.currentTarget)
      }}
    >
      <div
        aria-hidden
        className={`pointer-events-none relative flex h-10 w-7 shrink-0 flex-col overflow-hidden rounded-lg border transition-[transform,background-color,border-color,box-shadow] duration-100 ${
          isPressed
            ? "scale-[0.92] border-[#555] shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)]"
            : "border-[#333] shadow-none"
        }`}
        style={{
          backgroundColor: isPressed ? `${accentColor}28` : "#141414",
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase by $${ONBOARDING_ALLOCATE_FINE_STEP}`}
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-1/2 items-start justify-center pt-0.5"
        >
          <ChevronUp
            className={`h-3 w-3 transition-opacity ${isPressed ? "opacity-90" : "opacity-50"}`}
            style={{ color: accentColor }}
            aria-hidden
          />
        </button>
        <div
          className={`mx-auto my-1 w-1 flex-1 rounded-full transition-opacity ${isPressed ? "opacity-70" : "opacity-40"}`}
          style={{ backgroundColor: accentColor }}
          aria-hidden
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease by $${ONBOARDING_ALLOCATE_FINE_STEP}`}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-1/2 items-end justify-center pb-0.5"
        >
          <ChevronDown
            className={`h-3 w-3 transition-opacity ${isPressed ? "opacity-90" : "opacity-50"}`}
            style={{ color: accentColor }}
            aria-hidden
          />
        </button>
      </div>
    </div>
  )
}
