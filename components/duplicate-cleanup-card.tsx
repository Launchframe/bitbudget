"use client"

import { useMemo, useState } from "react"
import { CopyCheck, Loader2, Trash2 } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { formatUsdPrecise } from "@/lib/data"
import {
  defaultDeleteSelection,
  duplicateRowCount,
  findDuplicateClusters,
} from "@/lib/duplicate-clusters"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * Manual duplicate detection & cleanup.
 *
 * Scans decrypted transactions for rows sharing the same date, type, payee, and amount,
 * suggests keeping the earliest in each group, and bulk-deletes the rest. Locked rows and
 * funding-batch rows are excluded by `findDuplicateClusters`.
 */
export function DuplicateCleanupCard() {
  const { activeTransactions, historyReady, bulkDeleteTransactions } = useApp()
  const [scanned, setScanned] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [lastDeleted, setLastDeleted] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const clusters = useMemo(
    () => (scanned ? findDuplicateClusters(activeTransactions) : []),
    [scanned, activeTransactions],
  )
  const totalDuplicates = duplicateRowCount(clusters)

  const runScan = () => {
    const found = findDuplicateClusters(activeTransactions)
    setSelected(defaultDeleteSelection(found))
    setLastDeleted(null)
    setDeleteError(null)
    setScanned(true)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirmDelete = async () => {
    setConfirmOpen(false)
    setDeleting(true)
    setDeleteError(null)
    try {
      const ids = Array.from(selected)
      const count = await bulkDeleteTransactions(ids)
      setLastDeleted(count)
      setSelected(new Set())
      // clusters recomputes automatically when activeTransactions updates after deletion.
      setScanned(true)
    } catch (err) {
      setLastDeleted(null)
      setDeleteError(err instanceof Error ? err.message : "Delete failed. Try again.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#3B82F6]/10">
          <CopyCheck className="h-5 w-5 text-[#3B82F6]" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Find duplicate transactions</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Scan for transactions that look like exact copies (same date, payee, amount, and type) — for
        example after an interrupted import. We suggest keeping the oldest in each group and removing
        the rest. Review the list before deleting; this cannot be undone.
      </p>

      {!historyReady && (
        <p className="text-[11px] text-muted-foreground mb-4">
          Still loading your full history — scan again once it finishes for complete results.
        </p>
      )}

      <button
        type="button"
        onClick={runScan}
        disabled={deleting || activeTransactions.length === 0}
        className="flex items-center justify-center gap-2 py-3 px-6 bg-[#1A1A1A] text-foreground rounded-xl text-sm font-medium hover:bg-[#222] transition-colors border border-[#333] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <CopyCheck className="h-4 w-4" />
        {scanned ? "Re-scan" : "Scan for duplicates"}
      </button>

      {scanned && lastDeleted != null && (
        <p className="mt-4 text-sm text-[#22C55E]">
          Removed {lastDeleted} duplicate{lastDeleted === 1 ? "" : "s"}.
        </p>
      )}

      {deleteError && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {deleteError}
        </p>
      )}

      {scanned && clusters.length === 0 && lastDeleted == null && (
        <p className="mt-4 text-sm text-muted-foreground">No duplicates found.</p>
      )}

      {clusters.length > 0 && (
        <>
          <div className="mt-4 flex flex-col gap-4 max-h-[420px] overflow-y-auto pr-1">
            {clusters.map((cluster) => (
              <div key={cluster.key} className="rounded-xl border border-[#1F1F1F] p-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {cluster.transactions.length} copies
                </div>
                <div className="flex flex-col gap-1.5">
                  {cluster.transactions.map((txn, idx) => {
                    const isKeeper = idx === 0
                    return (
                      <label
                        key={txn.id}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[#1A1A1A] cursor-pointer"
                      >
                        <Checkbox
                          checked={selected.has(txn.id)}
                          onCheckedChange={() => toggle(txn.id)}
                          aria-label={`Delete duplicate ${txn.payee} on ${txn.date}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-foreground">{txn.payee}</span>
                            {isKeeper && (
                              <span className="shrink-0 rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-medium text-[#22C55E]">
                                Suggested keep
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {txn.date} · {formatUsdPrecise(txn.amount)} · {txn.type}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting || selected.size === 0}
              className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-medium transition-colors border border-red-500/30 bg-[#1A1A1A] text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? "Deleting…" : `Delete ${selected.size} selected`}
            </button>
            <span className="text-xs text-muted-foreground">
              {totalDuplicates} duplicate{totalDuplicates === 1 ? "" : "s"} across {clusters.length}{" "}
              group{clusters.length === 1 ? "" : "s"}
            </span>
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} transactions?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {selected.size} selected duplicate
              {selected.size === 1 ? "" : "s"}. The transactions you kept are not affected. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#1F1F1F]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleConfirmDelete()
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete duplicates
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
