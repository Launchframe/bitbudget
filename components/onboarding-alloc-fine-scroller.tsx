"use client"

import { useId, useRef, useState, type KeyboardEvent } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { ONBOARDING_ALLOCATE_FINE_STEP } from "@/lib/onboarding-allocate-budget"
import { formatUsd } from "@/lib/data"

const SWIPE_PX_PER_STEP = 10
const TAP_MOVE_THRESHOLD_PX = 8
const GESTURE_COMMIT_PX = 10
const PAGE_KEY_STEP_MULTIPLIER = 10
/** Visible track height — keep in sync with inner `h-10`. */
const VISIBLE_TRACK_HEIGHT_PX = 40

type OnboardingAllocFineScrollerProps = {
  accentColor: string
  ariaLabel: string
  value: number
  maxValue: number
  onGestureStart: () => void
  onNudge: (deltaSteps: number) => void
  onGestureEnd: () => void
}

export function OnboardingAllocFineScroller({
  accentColor,
  ariaLabel,
  value,
  maxValue,
  onGestureStart,
  onNudge,
  onGestureEnd,
}: OnboardingAllocFineScrollerProps) {
  const hintId = useId()
  const hitRef = useRef<HTMLDivElement>(null)
  const [isPressed, setIsPressed] = useState(false)
  const pointerRef = useRef<{
    pointerId: number
    startY: number
    startX: number
    lastStepY: number
    swipeNudgeCount: number
    committed: boolean
  } | null>(null)

  const commitGesture = (pointerId: number, target: HTMLElement) => {
    const session = pointerRef.current
    if (!session || session.pointerId !== pointerId || session.committed) return
    session.committed = true
    setIsPressed(true)
    onGestureStart()
    try {
      target.setPointerCapture(pointerId)
    } catch {
      /* noop */
    }
  }

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

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let deltaSteps = 0
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        deltaSteps = 1
        break
      case "ArrowDown":
      case "ArrowLeft":
        deltaSteps = -1
        break
      case "PageUp":
        deltaSteps = PAGE_KEY_STEP_MULTIPLIER
        break
      case "PageDown":
        deltaSteps = -PAGE_KEY_STEP_MULTIPLIER
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    onGestureStart()
    onNudge(deltaSteps)
    onGestureEnd()
  }

  const stepLabel = formatUsd(ONBOARDING_ALLOCATE_FINE_STEP)
  const pageStepLabel = formatUsd(ONBOARDING_ALLOCATE_FINE_STEP * PAGE_KEY_STEP_MULTIPLIER)

  return (
    <div
      ref={hitRef}
      role="spinbutton"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuetext={`${formatUsd(value)} per month`}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, maxValue)}
      aria-describedby={hintId}
      className="relative flex w-7 shrink-0 select-none items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0D0D] max-md:pointer-events-auto"
      style={{
        touchAction: "pan-x",
        height: VISIBLE_TRACK_HEIGHT_PX,
      }}
      onPointerDown={e => {
        if (e.button !== 0) return
        pointerRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          lastStepY: e.clientY,
          swipeNudgeCount: 0,
          committed: false,
        }
      }}
      onPointerMove={e => {
        const session = pointerRef.current
        if (!session || session.pointerId !== e.pointerId) return

        if (!session.committed) {
          const dx = e.clientX - session.startX
          const dy = e.clientY - session.startY
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > GESTURE_COMMIT_PX) {
            pointerRef.current = null
            return
          }
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > GESTURE_COMMIT_PX) {
            commitGesture(e.pointerId, e.currentTarget)
          } else {
            return
          }
        }

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

        if (!session.committed) {
          const moved = Math.hypot(e.clientX - session.startX, e.clientY - session.startY)
          if (moved <= TAP_MOVE_THRESHOLD_PX) {
            onGestureStart()
            nudgeFromTap(session.startY)
            onGestureEnd()
          }
          pointerRef.current = null
          return
        }

        e.stopPropagation()
        const moved = Math.abs(e.clientY - session.startY)
        if (session.swipeNudgeCount === 0 && moved <= TAP_MOVE_THRESHOLD_PX) {
          nudgeFromTap(session.startY)
        }
        finishGesture(e.pointerId, e.currentTarget)
      }}
      onPointerCancel={e => {
        if (pointerRef.current?.pointerId !== e.pointerId) return
        if (pointerRef.current.committed) {
          e.stopPropagation()
          finishGesture(e.pointerId, e.currentTarget)
          return
        }
        pointerRef.current = null
      }}
      onKeyDown={handleKeyDown}
    >
      <span id={hintId} className="sr-only">
        Arrow keys adjust by {stepLabel}. Page Up and Page Down adjust by {pageStepLabel}. Swipe or tap
        the top or bottom half to fine tune.
      </span>
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
        <div
          role="presentation"
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-1/2 items-start justify-center pt-0.5"
        >
          <ChevronUp
            className={`h-3 w-3 transition-opacity ${isPressed ? "opacity-90" : "opacity-50"}`}
            style={{ color: accentColor }}
            aria-hidden
          />
        </div>
        <div
          className={`mx-auto my-1 w-1 flex-1 rounded-full transition-opacity ${isPressed ? "opacity-70" : "opacity-40"}`}
          style={{ backgroundColor: accentColor }}
          aria-hidden
        />
        <div
          role="presentation"
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-1/2 items-end justify-center pb-0.5"
        >
          <ChevronDown
            className={`h-3 w-3 transition-opacity ${isPressed ? "opacity-90" : "opacity-50"}`}
            style={{ color: accentColor }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  )
}
