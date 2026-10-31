"use client"

import { useState } from "react"
import { FileText, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { suggestShoppingRequestId } from "@/lib/shopping-receipt-plan"
import type { ShoppingMatchRequest } from "@/lib/shopping-item-matcher"

export interface ReceiptDraftLine {
  description: string
  cents: number
  requestId: string | null
}

interface DraftRow {
  key: string
  description: string
  amount: string
  requestId: string
  touched: boolean
}

export function ShoppingReceiptDialog({
  busy,
  requests,
  members,
  onClose,
  onSave,
}: {
  busy: boolean
  requests: readonly ShoppingMatchRequest[]
  members: ReadonlyArray<{ id: string; alias: string }>
  onClose: () => void
  onSave: (merchant: string, totalCents: number, lines: ReceiptDraftLine[]) => void
}) {
  const [merchant, setMerchant] = useState("")
  const [amount, setAmount] = useState("")
  const [rows, setRows] = useState<DraftRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const openRequests = requests.filter((request) => request.requestedQuantity > request.purchasedQuantity)

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function onDescription(row: DraftRow, description: string) {
    if (row.touched) {
      updateRow(row.key, { description })
      return
    }
    const suggestion = suggestShoppingRequestId(description, openRequests)
    updateRow(row.key, { description, requestId: suggestion ?? "" })
  }

  function save() {
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
    onSave(merchant.trim(), totalCents, lines)
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="max-h-[min(90vh,40rem)] max-w-[min(96vw,32rem)] overflow-y-auto rounded-2xl"
        onKeyDown={(event) =>
          handleDialogEnterToPrimary(event, {
            disabled: busy || !merchant.trim() || !amount.trim(),
            onPrimary: save,
          })
        }
      >
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Add a shared receipt</DialogTitle>
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
              <label className="flex min-w-0 flex-col gap-1 text-sm">
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
                </select>
              </label>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
          <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
          A matching name is filled in for you. Change it if it is wrong.
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !merchant.trim() || !amount.trim()} onClick={save}>
            Save and split
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
