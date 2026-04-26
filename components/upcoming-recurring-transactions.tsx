"use client"

import { useId, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import type { RecurringTransaction } from "@/lib/data"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
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
import { Repeat, Play, Pencil, Trash2, X, ChevronDown, ChevronUp } from "lucide-react"

type Cadence = RecurringTransaction["cadence"]

const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
}

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
]

function formatDueDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dueUtc = Date.UTC(year, month - 1, day)
  const diffDays = Math.round((dueUtc - todayUtc) / 86400000)
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  if (diffDays === 0) return `Today · ${formatted}`
  if (diffDays === 1) return `Tomorrow · ${formatted}`
  if (diffDays > 0 && diffDays <= 7) return `In ${diffDays} days · ${formatted}`
  return formatted
}

// ─── Edit Recurring Dialog ────────────────────────────────────────────────────

interface EditRecurringDialogProps {
  rule: RecurringTransaction
  onClose: () => void
}

function EditRecurringDialog({ rule, onClose }: EditRecurringDialogProps) {
  const { activeEnvelopes, state, editRecurringTransaction, deleteRecurringTransaction } = useApp()
  const payeeIsMasked = rule.payee === ENCRYPTED_DISPLAY
  const notesAreMasked = rule.notes === ENCRYPTED_DISPLAY

  const [payee, setPayee] = useState(
    payeeIsMasked ? "" : rule.payee,
  )
  const [amount, setAmount] = useState(String(rule.amount))
  const [type, setType] = useState<"expense" | "credit">(rule.type as "expense" | "credit")
  const [envelopeId, setEnvelopeId] = useState(rule.envelopeId)
  const [cadence, setCadence] = useState<Cadence>(rule.cadence)
  const [endDate, setEndDate] = useState(rule.endDate ?? "")
  const [selectedTags, setSelectedTags] = useState<string[]>(rule.tags)
  const [notes, setNotes] = useState(
    notesAreMasked || !rule.notes ? "" : rule.notes,
  )
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  async function handleSave() {
    const errs: Record<string, string> = {}
    const parsedAmount = Number(amount)
    if (!payeeIsMasked && !payee.trim()) errs.payee = "Payee is required"
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) errs.amount = "Amount must be positive"
    if (!envelopeId) errs.envelope = "Envelope is required"
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      const updates: Parameters<typeof editRecurringTransaction>[1] = {
        amount: parsedAmount,
        type,
        envelopeId,
        cadence,
        endDate: endDate || null,
        tags: selectedTags,
      }
      if (!payeeIsMasked || payee.trim()) {
        updates.payee = payee.trim()
      }
      if (!notesAreMasked || notes.trim()) {
        updates.notes = notes.trim() || null
      }
      await editRecurringTransaction(rule.id, updates)
      onClose()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        form: e instanceof Error ? e.message : "Could not save changes. Please try again.",
      }))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setSubmitting(true)
    try {
      await deleteRecurringTransaction(rule.id)
      onClose()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        form: e instanceof Error ? e.message : "Could not delete rule. Please try again.",
      }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
            <Repeat className="h-4 w-4 text-btc-orange" />
            Edit Recurring Rule
          </DialogTitle>
        </DialogHeader>

        {errors.form && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {errors.form}
          </div>
        )}

        <div className="flex flex-col gap-5">
          {/* Type toggle */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Type</Label>
            <div className="flex rounded-lg bg-[#1A1A1A] p-1">
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  type === "expense"
                    ? "bg-btc-orange text-[#0D0D0D]"
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
                    ? "bg-success text-[#0D0D0D]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Credit
              </button>
            </div>
          </div>

          {/* Payee */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">
              {type === "expense" ? "Payee" : "Payer"}
            </Label>
            <Input
              value={payee}
              onChange={(e) => {
                setPayee(e.target.value)
                if (errors.payee) setErrors((prev) => { const n = { ...prev }; delete n.payee; return n })
              }}
              placeholder={
                rule.isDecrypted === false
                  ? "Session locked — re-enter to update"
                  : type === "expense"
                    ? "Who do you pay?"
                    : "Who pays you?"
              }
              className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
            />
            {errors.payee && <p className="text-xs text-red-400">{errors.payee}</p>}
          </div>

          {/* Amount */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Amount (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  if (errors.amount) setErrors((prev) => { const n = { ...prev }; delete n.amount; return n })
                }}
                placeholder="0.00"
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7"
              />
            </div>
            {errors.amount && <p className="text-xs text-red-400">{errors.amount}</p>}
          </div>

          {/* Envelope */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelope</Label>
            <Select
              value={envelopeId}
              onValueChange={(v) => {
                setEnvelopeId(v)
                if (errors.envelope) setErrors((prev) => { const n = { ...prev }; delete n.envelope; return n })
              }}
            >
              <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                <SelectValue placeholder="Select an envelope" />
              </SelectTrigger>
              <SelectContent className="bg-[#1A1A1A] border-[#333]">
                {activeEnvelopes.map((env) => (
                  <SelectItem
                    key={env.id}
                    value={env.id}
                    className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: env.color }} />
                      {env.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.envelope && <p className="text-xs text-red-400">{errors.envelope}</p>}
          </div>

          {/* Cadence */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
              <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1A1A1A] border-[#333]">
                {CADENCE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* End Date */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">
              End Date <span className="text-[#555] normal-case">(optional)</span>
            </Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-[#1A1A1A] border-[#333] text-foreground"
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">
              Notes <span className="text-[#555] normal-case">(optional)</span>
            </Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes..."
              rows={2}
              className="w-full rounded-md bg-[#1A1A1A] border border-[#333] text-foreground placeholder:text-[#555] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-btc-orange/50 focus:border-btc-orange/50"
            />
          </div>

          {/* Tags */}
          {state.tags.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Tags</Label>
              <div className="flex flex-wrap gap-2">
                {state.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    asChild
                    variant={selectedTags.includes(tag.name) ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      selectedTags.includes(tag.name)
                        ? "bg-btc-orange text-[#0D0D0D] hover:bg-btc-orange/80 border-transparent"
                        : "border-[#333] text-muted-foreground hover:border-btc-orange/50 hover:text-foreground"
                    }`}
                  >
                    <button type="button" onClick={() => toggleTag(tag.name)} className="inline-flex items-center gap-1">
                      {tag.name}
                      {selectedTags.includes(tag.name) && <X className="h-3 w-3 shrink-0" aria-hidden />}
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-[#1A1A1A] text-foreground rounded-lg text-sm font-medium hover:bg-[#222] transition-colors border border-[#333]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="flex-1 py-2.5 bg-btc-orange text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-btc-orange/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>

          {/* Delete */}
          <div className="border-t border-[#1F1F1F] pt-4">
            {confirmDelete ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground text-center">
                  Delete this recurring rule? Future transactions will no longer be created automatically.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2 bg-[#1A1A1A] text-foreground rounded-lg text-sm border border-[#333] hover:bg-[#222] transition-colors"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={submitting}
                    className="flex-1 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    Delete Rule
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Rule
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UpcomingRecurringTransactions() {
  const { recurringTransactions, activeEnvelopes, openNewTransaction } = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringTransaction | null>(null)
  const listId = useId()

  const active = recurringTransactions.filter((r) => r.active)
  if (active.length === 0) return null

  function handlePostNow(rule: RecurringTransaction) {
    openNewTransaction({
      payee: rule.isDecrypted !== false && rule.payee !== ENCRYPTED_DISPLAY ? rule.payee : undefined,
      amount: String(rule.amount),
      type: rule.type as "expense" | "credit",
      envelopeId: rule.envelopeId,
      tags: rule.tags,
      notes:
        rule.notes && rule.notes !== ENCRYPTED_DISPLAY ? rule.notes : undefined,
      date: new Date().toISOString().split("T")[0],
      recurringId: rule.id,
    })
  }

  return (
    <>
      {editingRule && (
        <EditRecurringDialog rule={editingRule} onClose={() => setEditingRule(null)} />
      )}

      <div className="mb-4">
        {/* Section header */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls={listId}
          className="w-full flex items-center justify-between mb-2 group"
        >
          <div className="flex items-center gap-2">
            <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Upcoming Recurring
            </span>
            <span className="text-xs text-muted-foreground/60">({active.length})</span>
          </div>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        <div id={listId} hidden={collapsed} className="flex flex-col gap-1.5">
          {active.map((rule) => {
              const env = activeEnvelopes.find((e) => e.id === rule.envelopeId)
              const isExpense = rule.type === "expense"
              const payeeLabel =
                rule.isDecrypted === false && rule.payee === ENCRYPTED_DISPLAY
                  ? "(encrypted)"
                  : rule.payee

              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-4 py-3 bg-[#111] rounded-xl border border-[#1F1F1F] hover:border-[#2A2A2A] transition-colors"
                >
                  {/* Left: recurring indicator + envelope color */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div
                      className="w-1 self-stretch rounded-full"
                      style={{ backgroundColor: env?.color ?? "#555", minHeight: 28 }}
                    />
                    <Repeat className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </div>

                  {/* Center: payee + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{payeeLabel}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{formatDueDate(rule.nextDueDate)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1A1A1A] text-muted-foreground border border-[#2A2A2A]">
                        {CADENCE_LABELS[rule.cadence]}
                      </span>
                      {env && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: env.color }} />
                          {env.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: amount + actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        isExpense ? "text-foreground" : "text-success"
                      }`}
                    >
                      {isExpense ? "-" : "+"}
                      {formatUsd(rule.amount)}
                    </span>

                    <button
                      type="button"
                      onClick={() => setEditingRule(rule)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A] transition-colors"
                      aria-label="Edit recurring rule"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePostNow(rule)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-btc-orange/10 text-btc-orange hover:bg-btc-orange/20 transition-colors text-xs font-medium border border-btc-orange/20"
                      aria-label="Post this transaction now"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      Post Now
                    </button>
                  </div>
                </div>
              )
          })}
        </div>
      </div>
    </>
  )
}
