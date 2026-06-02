"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Scrollable region with a bottom fade when more content is below the fold.
 * Pass `max-h-*` via className on this component — it applies to the scrollport
 * (max-height and overflow must live on the same element).
 */
export function ScrollOverflowHint({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 8)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const child of el.children) {
      ro.observe(child)
    }
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [update, children])

  return (
    <div className="relative min-w-0">
      <div
        ref={ref}
        className={cn(
          "relative overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]",
          className,
          contentClassName,
        )}
      >
        {children}
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[#0D0D0D] via-[#0D0D0D]/80 to-transparent transition-opacity duration-200",
          canScrollDown ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
    </div>
  )
}
