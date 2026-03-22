"use client"

import { useApp } from "@/lib/app-context"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Non-blocking hint while older transactions / API sync are still loading, or after a sync failure. */
export function TransactionLoadingIndicator() {
  const {
    txnLoadPhase,
    transactionSyncError,
    clearTransactionSyncError,
    refreshData,
  } = useApp()

  if (transactionSyncError) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200/90 sm:flex-row sm:items-center sm:justify-between"
      >
        <span>Couldn&apos;t sync transactions: {transactionSyncError}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 border-red-800/80 bg-transparent text-red-100 hover:bg-red-900/40"
            onClick={() => {
              clearTransactionSyncError()
              void refreshData()
            }}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-red-200/80 hover:bg-red-900/30 hover:text-red-100"
            onClick={clearTransactionSyncError}
          >
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

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
