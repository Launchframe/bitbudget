"use client"

import { useState, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, formatBtcAmount } from "@/lib/data"
import type { Transaction, TransactionType } from "@/lib/data"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Pencil, Trash2, Repeat, X } from "lucide-react"

interface TransactionDetailDialogProps {
  transaction: Transaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransactionDetailDialog({ transaction, open, onOpenChange }: TransactionDetailDialogProps) {
  const { state, editTransaction, deleteTransaction, addTag } = useApp()
  const { getPriceOnDate, currentPrice } = useBtcPrices()

  const [editing, setEditing] = useState(false)
  const [payee, setPayee] = useState("")
  const [amount, setAmount] = useState("")
  const [type, setType] = useState<TransactionType>("expense")
  const [envelopeId, setEnvelopeId] = useState("")
  const [date, setDate] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (transaction && open) {
      setPayee(transaction.payee)
      setAmount(String(transaction.amount))
      setType(transaction.type)
      setEnvelopeId(transaction.envelopeId)
      setDate(transaction.date)
      setSelectedTags(transaction.tags)
      setNotes(transaction.notes ?? "")
      setEditing(false)
      setNewTag("")
    }
  }, [transaction, open])

  if (!transaction) return null

  const envelope = state.envelopes.find((e) => e.id === transaction.envelopeId)
  const btcPrice = getPriceOnDate(transaction.date)
  const btcEquiv = btcPrice > 0 ? transaction.amount / btcPrice : 0
  const btcValueToday = currentPrice && btcPrice > 0 ? (transaction.amount / btcPrice) * currentPrice : 0

  function handleClose() {
    setEditing(false)
    onOpenChange(false)
  }

  async function handleSave() {
    if (!payee.trim() || !amount || !envelopeId || !date) return
    setSaving(true)
    try {
      await editTransaction(transaction!.id, {
        payee: payee.trim(),
        amount: Math.abs(parseFloat(amount)),
        type,
        envelopeId,
        date,
        tags: selectedTags,
        notes: notes.trim() || null,
      })
      setEditing(false)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    deleteTransaction(transaction!.id)
    onOpenChange(false)
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  function handleAddNewTag() {
    const trimmed = newTag.trim()
    if (trimmed && !state.tags.includes(trimmed)) addTag(trimmed)
    if (trimmed) setSelectedTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setNewTag("")
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-foreground">
              {editing ? "Edit Transaction" : "Transaction Details"}
            </DialogTitle>
            {!editing && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 rounded-lg hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Edit transaction"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-1.5 rounded-lg hover:bg-[#1A1A1A] text-muted-foreground hover:text-[#EF4444] transition-colors"
                  aria-label="Delete transaction"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Type</Label>
              <div className="flex rounded-lg bg-[#1A1A1A] p-1">
                <button
                  type="button"
                  onClick={() => setType("expense")}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    type === "expense"
                      ? "bg-[#F7931A] text-[#0D0D0D]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => setType("credit")}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    type === "credit"
                      ? "bg-[#22C55E] text-[#0D0D0D]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Credit
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Payee</Label>
              <Input
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                className="bg-[#1A1A1A] border-[#333] text-foreground"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Amount (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-[#1A1A1A] border-[#333] text-foreground pl-7"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelope</Label>
              <Select value={envelopeId} onValueChange={setEnvelopeId}>
                <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1A1A1A] border-[#333]">
                  {state.envelopes.map((env) => (
                    <SelectItem key={env.id} value={env.id} className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: env.color }} />
                        {env.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-[#1A1A1A] border-[#333] text-foreground"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Tags</Label>
              <div className="flex flex-wrap gap-2">
                {state.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      selectedTags.includes(tag)
                        ? "bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/80 border-transparent"
                        : "border-[#333] text-muted-foreground hover:border-[#F7931A]/50 hover:text-foreground"
                    }`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                    {selectedTags.includes(tag) && <X className="ml-1 h-3 w-3" />}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleAddNewTag() }
                  }}
                  placeholder="Add new tag..."
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] h-8 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Notes</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes..."
                rows={2}
                className="w-full rounded-md bg-[#1A1A1A] border border-[#333] text-foreground placeholder:text-[#555] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#F7931A]/50 focus:border-[#F7931A]/50"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-2.5 rounded-lg border border-[#333] text-sm font-medium text-muted-foreground hover:text-foreground hover:border-[#555] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        ) : (
          <ViewMode
            transaction={transaction}
            envelope={envelope}
            btcPrice={btcPrice}
            btcEquiv={btcEquiv}
            btcValueToday={btcValueToday}
            currentPrice={currentPrice}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ViewMode({
  transaction,
  envelope,
  btcPrice,
  btcEquiv,
  btcValueToday,
  currentPrice,
}: {
  transaction: Transaction
  envelope?: { name: string; color: string; monthlyAllotment: number }
  btcPrice: number
  btcEquiv: number
  btcValueToday: number
  currentPrice: number | null
}) {
  const { state } = useApp()
  const multiplier = transaction.amount > 0 && btcValueToday > 0 ? btcValueToday / transaction.amount : 0
  const gained = multiplier >= 1

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Date",
      value: new Date(transaction.date).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      }),
    },
    {
      label: "Type",
      value: (
        <Badge
          variant="outline"
          className={
            transaction.type === "expense"
              ? "border-[#F7931A]/30 text-[#F7931A] bg-[#F7931A]/5"
              : "border-[#22C55E]/30 text-[#22C55E] bg-[#22C55E]/5"
          }
        >
          {transaction.type === "expense" ? "Expense" : "Credit"}
          {transaction.recurringId && (
            <span className="ml-1 inline-flex"><Repeat className="h-3 w-3" /></span>
          )}
        </Badge>
      ),
    },
    { label: "Amount", value: <span className="font-semibold">{formatUsd(transaction.amount)}</span> },
    ...(envelope
      ? [{
          label: "Envelope",
          value: (
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: envelope.color }} />
              {envelope.name}
            </span>
          ),
        }]
      : []),
    ...(transaction.tags.length > 0
      ? [{
          label: "Tags",
          value: (
            <div className="flex flex-wrap gap-1 justify-end">
              {transaction.tags.map((tag) => (
                <span key={tag} className="text-xs bg-[#1A1A1A] text-muted-foreground px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          ),
        }]
      : []),
    ...(transaction.notes
      ? [{ label: "Notes", value: <span className="text-sm text-muted-foreground italic">{transaction.notes}</span> }]
      : []),
  ]

  if (transaction.type === "expense" && btcPrice > 0) {
    rows.push(
      { label: "BTC Price at Time", value: formatUsd(btcPrice) },
      { label: "BTC Equivalent", value: <span className="font-mono text-sm">{formatBtcAmount(btcEquiv, state.btcDisplayUnit)}</span> },
    )

    if (currentPrice) {
      rows.push(
        {
          label: "BTC Value Today",
          value: (
            <span className={`font-semibold ${gained ? "text-[#F7931A]" : "text-[#22C55E]"}`}>
              {formatUsd(btcValueToday)}
              <span className="ml-1.5 text-xs font-normal opacity-80">
                ({gained ? "+" : ""}{((multiplier - 1) * 100).toFixed(0)}%)
              </span>
            </span>
          ),
        },
      )
    }
  }

  return (
    <div className="flex flex-col gap-3.5 pt-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4">
          <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
          <span className="text-sm text-foreground text-right">{row.value}</span>
        </div>
      ))}
    </div>
  )
}
