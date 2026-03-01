"use client"

import { useState } from "react"
import { useApp } from "@/lib/app-context"
import type { TransactionType } from "@/lib/data"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { X, Repeat } from "lucide-react"

type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
]

export function NewTransactionDialog() {
  const { state, transactionDialogOpen, setTransactionDialogOpen, addTransaction, addTag, refreshData } = useApp()

  const [type, setType] = useState<TransactionType>("expense")
  const [payee, setPayee] = useState("")
  const [amount, setAmount] = useState("")
  const [envelopeId, setEnvelopeId] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [notes, setNotes] = useState("")

  const [isRecurring, setIsRecurring] = useState(false)
  const [cadence, setCadence] = useState<Cadence>("monthly")
  const [endDate, setEndDate] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function resetForm() {
    setType("expense")
    setPayee("")
    setAmount("")
    setEnvelopeId("")
    setDate(new Date().toISOString().split("T")[0])
    setSelectedTags([])
    setNewTag("")
    setNotes("")
    setIsRecurring(false)
    setCadence("monthly")
    setEndDate("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!payee.trim() || !amount || !envelopeId) return

    if (isRecurring) {
      setSubmitting(true)
      try {
        const res = await fetch("/api/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payee: payee.trim(),
            amount: Math.abs(parseFloat(amount)),
            type,
            envelopeId,
            cadence,
            startDate: date,
            endDate: endDate || null,
            tags: selectedTags,
            notes: notes.trim() || null,
          }),
        })
        if (res.ok) {
          await refreshData()
        }
      } finally {
        setSubmitting(false)
      }
    } else {
      addTransaction({
        date,
        payee: payee.trim(),
        amount: Math.abs(parseFloat(amount)),
        type,
        envelopeId,
        tags: selectedTags,
        notes: notes.trim() || null,
      })
    }

    resetForm()
    setTransactionDialogOpen(false)
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  function handleAddNewTag() {
    const trimmed = newTag.trim()
    if (trimmed && !state.tags.includes(trimmed)) {
      addTag(trimmed)
    }
    if (trimmed) {
      setSelectedTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    }
    setNewTag("")
  }

  return (
    <Dialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">New Transaction</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
            <Label htmlFor="payee" className="text-muted-foreground text-xs uppercase tracking-wider">
              {type === "expense" ? "Payee" : "Payer"}
            </Label>
            <Input
              id="payee"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder={type === "expense" ? "Who did you pay?" : "Who paid you?"}
              className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="amount" className="text-muted-foreground text-xs uppercase tracking-wider">Amount (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelope</Label>
            <Select value={envelopeId} onValueChange={setEnvelopeId} required>
              <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                <SelectValue placeholder="Select an envelope" />
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
            <Label htmlFor="date" className="text-muted-foreground text-xs uppercase tracking-wider">
              {isRecurring ? "Start Date" : "Date"}
            </Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-[#1A1A1A] border-[#333] text-foreground"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes" className="text-muted-foreground text-xs uppercase tracking-wider">
              Notes <span className="text-[#555] normal-case">(optional)</span>
            </Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes..."
              rows={2}
              className="w-full rounded-md bg-[#1A1A1A] border border-[#333] text-foreground placeholder:text-[#555] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#F7931A]/50 focus:border-[#F7931A]/50"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="recurring-toggle" className="text-sm text-foreground cursor-pointer">
                Recurring
              </Label>
            </div>
            <Switch
              id="recurring-toggle"
              checked={isRecurring}
              onCheckedChange={setIsRecurring}
              className="data-[state=checked]:bg-[#F7931A]"
            />
          </div>

          {isRecurring && (
            <div className="flex flex-col gap-4 p-3 bg-[#1A1A1A]/50 rounded-lg border border-[#1F1F1F]">
              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">Cadence</Label>
                <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
                  <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-[#333]">
                    {CADENCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="end-date" className="text-muted-foreground text-xs uppercase tracking-wider">
                  End Date <span className="text-[#555] normal-case">(optional)</span>
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-[#1A1A1A] border-[#333] text-foreground"
                />
              </div>
            </div>
          )}

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
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleAddNewTag()
                  }
                }}
                placeholder="Add new tag..."
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] h-8 text-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-lg font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors mt-2 disabled:opacity-50"
          >
            {submitting ? "Creating..." : isRecurring ? `Add Recurring ${type === "expense" ? "Expense" : "Credit"}` : type === "expense" ? "Add Expense" : "Add Credit"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
