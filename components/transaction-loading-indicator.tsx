"use client"

import { useApp } from "@/lib/app-context"
import { Spinner } from "@/components/ui/spinner"

/** Non-blocking hint while older transactions / API sync are still loading. */
export function TransactionLoadingIndicator() {
  const { txnLoadPhase } = useApp()

  if (txnLoadPhase !== "recent" && txnLoadPhase !== "full") {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-lg border border-[#333] bg-[#1A1A1A]/90 px-3 py-2 text-xs text-muted-foreground"
    >
      <Spinner className="h-3.5 w-3.5 shrink-0 text-[#F7931A]" />
      <span>Loading your full transaction history…</span>
    </div>
  )
}
