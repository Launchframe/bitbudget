"use client"

import { useCallback, useState } from "react"
import type { Transaction } from "@/lib/data"
import { useApp } from "@/lib/app-context"
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
import {
  incomeBatchDeleteConfirmMessage,
  shouldConfirmIncomeBatchDelete,
} from "@/lib/transaction-batch-delete"

type PendingDelete = {
  txn: Transaction
  afterDelete?: () => void
}

/** Prompt before deleting income headers that still have envelope funding legs. */
export function useTransactionDeleteConfirm() {
  const { deleteTransaction, state } = useApp()
  const [pending, setPending] = useState<PendingDelete | null>(null)

  const requestDelete = useCallback(
    (txn: Transaction, afterDelete?: () => void) => {
      if (shouldConfirmIncomeBatchDelete(txn, state.transactions)) {
        setPending({ txn, afterDelete })
        return
      }
      void deleteTransaction(txn.id)
      afterDelete?.()
    },
    [deleteTransaction, state.transactions],
  )

  const handleCancel = useCallback(() => {
    setPending(null)
  }, [])

  const handleConfirm = useCallback(() => {
    if (!pending) return
    void deleteTransaction(pending.txn.id)
    pending.afterDelete?.()
    setPending(null)
  }, [deleteTransaction, pending])

  const confirmDialog = (
    <AlertDialog open={pending != null} onOpenChange={(open) => !open && handleCancel()}>
      <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F]">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete income?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending ? incomeBatchDeleteConfirmMessage(pending.txn.source) : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-[#1F1F1F]">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-[#EF4444] text-white hover:bg-[#DC2626]"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { requestDelete, confirmDialog }
}
