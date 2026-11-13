"use client"

import { useEffect, useRef, useState } from "react"
import { FileText, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"
import { dollarsToCents, newShoppingObjectId } from "@/lib/shopping-payloads"
import { assignmentForReceiptDescription } from "@/lib/shopping-receipt-plan"
import {
  clearShoppingReceiptDraft,
  loadShoppingReceiptDraft,
  saveShoppingReceiptDraft,
  type ShoppingReceiptDraftRow,
} from "@/lib/shopping-receipt-draft"
import type { ShoppingMatchRequest } from "@/lib/shopping-item-matcher"

export interface ReceiptDraftLine {
  description: string
  cents: number
  requestId: string | null
}

export type ReceiptSaveResult =
  | { ok: true; warning?: string }
  | { ok: false; message: string }
  | { ok: false; ignored: true }

interface DraftRow {
  key: string
  description: string
  amount: string
  requestId: string
  touched: boolean
}

function toDraftRow(row: ShoppingReceiptDraftRow): DraftRow {
  return {
    key: row.key,
    description: row.description,
    amount: row.amount,
    requestId: row.requestId,
    touched: row.touched,
  }
}

function selectedRequestLabel(
  requestId: string,
  requests: ReadonlyArray<ShoppingMatchRequest & { checkedOff?: boolean }>,
  members: ReadonlyArray<{ id: string; alias: string }>,
): string {
  const selected = requests.find((request) => request.id === requestId)
  if (!selected) return "That choice is no longer available"
  const who = members.find((member) => member.id === selected.memberId)?.alias ?? "Someone"
  return `${selected.description} · ${who}`
}

export function ShoppingReceiptDialog({
  groupId,
  busy,
  requests,
  members,
  onClose,
  onSave,
}: {
  groupId: string
  busy: boolean
  requests: ReadonlyArray<ShoppingMatchRequest & { checkedOff?: boolean }>
  members: ReadonlyArray<{ id: string; alias: string }>
  onClose: () => void
  onSave: (merchant: string, totalCents: number, lines: ReceiptDraftLine[]) => Promise<ReceiptSaveResult>
}) {
  const restored = useState(() => loadShoppingReceiptDraft(groupId))[0]
  const [merchant, setMerchant] = useState(restored?.merchant ?? "")
  const [amount, setAmount] = useState(restored?.amount ?? "")
  const [rows, setRows] = useState<DraftRow[]>(() => restored?.rows.map(toDraftRow) ?? [])
  const [error, setError] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const childModalOpenRef = useRef(false)
  const saveLock = useRef(false)
  const openRequests = requests.filter(
    (request) => !request.checkedOff && request.requestedQuantity > request.purchasedQuantity,
  )
  const dirty =
    merchant.trim() !== "" ||
    amount.trim() !== "" ||
    rows.some((row) => row.description.trim() !== "" || row.amount.trim() !== "" || row.requestId !== "")

  useEffect(() => {
    if (!dirty) {
      if (loadShoppingReceiptDraft(groupId)) clearShoppingReceiptDraft()
      return
    }
    saveShoppingReceiptDraft({ version: 1, groupId, merchant, amount, rows })
  }, [dirty, groupId, merchant, amount, rows])

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function onDescription(row: DraftRow, description: string) {
    const requestId = assignmentForReceiptDescription({
      touched: row.touched,
      requestId: row.requestId,
      description,
      requests: openRequests,
    })
    updateRow(row.key, row.touched ? { description } : { description, requestId })
  }

  function openClear() {
    childModalOpenRef.current = true
    setClearOpen(true)
  }

  function onClearOpenChange(next: boolean) {
    if (next) {
      childModalOpenRef.current = true
      setClearOpen(true)
      return
    }
    setClearOpen(false)
    setTimeout(() => {
      childModalOpenRef.current = false
    }, 0)
  }

  function clearAll() {
    setMerchant("")
    setAmount("")
    setRows([])
    setError(null)
    clearShoppingReceiptDraft()
    onClearOpenChange(false)
  }

  async function save() {
    if (saveLock.current || busy) return
    const totalCents = dollarsToCents(amount)
    if (totalCents == null || totalCents <= 0) {
      setError("Enter a valid total")
      return
    }
    const lines: ReceiptDraftLine[] = []
    for (const row of rows) {
      const description = row.description.trim()
      const raw = row.amount.trim()
      if (!description && !raw) continue
      const cents = dollarsToCents(raw)
      if (!description || cents == null || cents <= 0) {
        setError("Each item needs a name and an amount")
        return
      }
      lines.push({
        description,
        cents,
        requestId: row.requestId || null,
      })
    }
    setError(null)
    saveLock.current = true
    try {
      const result = await onSave(merchant.trim(), totalCents, lines)
      if (!result.ok) {
        if ("message" in result) setError(result.message)
        return
      }
      clearShoppingReceiptDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save receipt")
    } finally {
      saveLock.current = false
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && childModalOpenRef.current) return
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="max-h-[min(90vh,40rem)] max-w-[min(96vw,32rem)] overflow-y-auto rounded-2xl"
        onKeyDown={(event) =>
          handleDialogEnterToPrimary(event, {
            disabled: busy || !merchant.trim() || !amount.trim(),
            onPrimary: () => {
              void save()
            },
          })
        }
      >
        <DialogHeader className="pr-10 text-left">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle>Add a shared receipt</DialogTitle>
            {dirty && (
              <Button type="button" variant="outline" size="sm" className="w-full shrink-0 sm:w-auto" onClick={openClear}>
                Clear All
              </Button>
            )}
          </div>
          <DialogDescription>
            Tie an item to someone on the list and they cover that amount. Anything left is split evenly. No money is transferred.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Store
          <Input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="e.g. Trader Joe's" />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Total
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="$0.00"
            inputMode="decimal"
          />
        </label>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Items</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { key: newShoppingObjectId(), description: "", amount: "", requestId: "", touched: false },
                ])
              }
            >
              <Plus className="size-4" />
              Add item
            </Button>
          </div>
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Leave this empty to split the whole receipt evenly.</p>
          )}
          {rows.map((row) => (
            <div key={row.key} className="flex min-w-0 flex-col gap-2 rounded-xl bg-secondary/40 p-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  className="min-w-0"
                  value={row.description}
                  aria-label="Item name"
                  placeholder="Item"
                  onChange={(event) => onDescription(row, event.target.value)}
                />
                <div className="flex gap-2">
                  <Input
                    className="min-w-0 flex-1 sm:w-24 sm:flex-none"
                    value={row.amount}
                    aria-label="Item amount"
                    placeholder="$0.00"
                    inputMode="decimal"
                    onChange={(event) => updateRow(row.key, { amount: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove item"
                    onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <label className="flex min-w-0 flex-col gap-1 text-sm" data-no-enter-submit="">
                Who asked for this
                <select
                  className="h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3"
                  value={row.requestId}
                  onChange={(event) =>
                    updateRow(row.key, { requestId: event.target.value, touched: true })
                  }
                >
                  <option value="">Split with everyone</option>
                  {openRequests.map((request) => {
                    const who = members.find((member) => member.id === request.memberId)?.alias ?? "Someone"
                    return (
                      <option key={request.id} value={request.id}>
                        {request.description} · {who}
                      </option>
                    )
                  })}
                  {row.requestId && !openRequests.some((request) => request.id === row.requestId) && (
                    <option value={row.requestId}>{selectedRequestLabel(row.requestId, requests, members)}</option>
                  )}
                </select>
              </label>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
          <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
          A matching name is filled in for you. Change it if it is wrong.
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={busy || !merchant.trim() || !amount.trim()}
            onClick={() => {
              void save()
            }}
          >
            Save and split
          </Button>
        </DialogFooter>
        <AlertDialog open={clearOpen} onOpenChange={onClearOpenChange}>
          <AlertDialogContent className="max-w-[min(96vw,28rem)]">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear this receipt?</AlertDialogTitle>
              <AlertDialogDescription>
                The store, total, and items you entered will be discarded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" onClick={(event) => event.stopPropagation()}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  clearAll()
                }}
              >
                Clear All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
