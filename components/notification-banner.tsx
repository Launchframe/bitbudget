"use client"

import { useState, useEffect } from "react"
import { Inbox, X } from "lucide-react"
import { useApp } from "@/lib/app-context"

export function NotificationBanner() {
  const { pendingCount, navigateTo } = useApp()
  const [dismissed, setDismissed] = useState(false)
  const [lastDismissedCount, setLastDismissedCount] = useState(0)

  useEffect(() => {
    queueMicrotask(() => {
      const stored = localStorage.getItem("bb-banner-dismissed-count")
      if (stored) setLastDismissedCount(parseInt(stored, 10))
    })
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      if (pendingCount > lastDismissedCount) {
        setDismissed(false)
      }
    })
  }, [pendingCount, lastDismissedCount])

  if (dismissed || pendingCount === 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border border-[#F7931A]/30 rounded-xl mb-4">
      <Inbox className="h-4 w-4 text-[#F7931A] shrink-0" />
      <p className="text-sm text-foreground flex-1">
        <span className="font-semibold text-[#F7931A]">{pendingCount}</span>{" "}
        {pendingCount === 1 ? "transaction needs" : "transactions need"} your review.
      </p>
      <button
        onClick={() => navigateTo("review-inbox")}
        className="text-xs font-semibold text-[#F7931A] hover:text-[#F7931A]/80 whitespace-nowrap"
      >
        Review now
      </button>
      <button
        onClick={() => {
          setDismissed(true)
          setLastDismissedCount(pendingCount)
          localStorage.setItem("bb-banner-dismissed-count", String(pendingCount))
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
