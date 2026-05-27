"use client"

import { useState, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"
import { FormattedBtcAmount } from "@/components/formatted-btc-sats-amount"
import type { Transaction, TransactionType } from "@/lib/data"
import {
  displayPayeeForTransaction,
  displayTypeLabelForTransaction,
  incomeTransactionForBatch,
  isEnvelopeFundingLeg,
  typeBadgeClassForTransaction,
} from "@/lib/ledger-funding-display"
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
import { Pencil, Trash2, Repeat, X, Bitcoin } from "lucide-react"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { cn } from "@/lib/utils"
import {
  dateInputValueFromTransactionDate,
  formatTransactionDetailDateTime,
  mergeCalendarDayIntoTransactionDate,
} from "@/lib/transaction-dates"

const CADENCE_LABELS = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
} as const

interface TransactionDetailDialogProps {
  transaction: Transaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set (e.g. Transactions page), jump to linked Income in-place instead of route navigation. */
  onNavigateToLinkedIncome?: (income: Transaction) => void
}

export function TransactionDetailDialog({
  transaction,
  open,
  onOpenChange,
  onNavigateToLinkedIncome,
}: TransactionDetailDialogProps) {
  const { state, activeEnvelopes, editTransaction, deleteTransaction, addTag, navigateTo } = useApp()
  const { getPriceOnDate, currentPrice, calculateOpportunityCost } = useBtcPrices()

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
  const systemFundingLeg = isEnvelopeFundingLeg(transaction)
  const linkedIncome = incomeTransactionForBatch(state.transactions, transaction.fundingBatchId)
  const linkedIncomePeer =
    linkedIncome && linkedIncome.id !== transaction.id && isEnvelopeFundingLeg(transaction)
      ? linkedIncome
      : undefined
  const displayPayee = displayPayeeForTransaction(transaction, state.transactions)
  const btcPrice = getPriceOnDate(transaction.date)
  const btcEquiv = btcPrice > 0 ? transaction.amount / btcPrice : 0
  const btcValueToday = currentPrice && btcPrice > 0 ? (transaction.amount / btcPrice) * currentPrice : 0
  const opportunityCost =
    transaction.type === "expense" && btcPrice > 0 && currentPrice
      ? calculateOpportunityCost(transaction.amount, transaction.date)
      : 0

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

  async function handleAddNewTag() {
    const trimmed = newTag.trim()
    if (trimmed && !state.tags.some((tag) => tag.name === trimmed)) await addTag(trimmed)
    if (trimmed) setSelectedTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setNewTag("")
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn("bg-[#0D0D0D] border-[#1F1F1F] max-w-md overflow-hidden", !editing && "pb-0")}>
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {editing ? "Edit Transaction" : "Transaction Details"}
          </DialogTitle>
        </DialogHeader>

        {editing && transaction.isDecrypted !== false ? (
          <div className="flex flex-col gap-4 pt-2 max-h-[70vh] overflow-y-auto pr-1">
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
                  {activeEnvelopes.map((env) => (
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
                value={dateInputValueFromTransactionDate(date)}
                onChange={(e) =>
                  setDate(mergeCalendarDayIntoTransactionDate(date, e.target.value))
                }
                className="bg-[#1A1A1A] border-[#333] text-foreground"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Tags</Label>
              <div className="flex flex-wrap gap-2">
                {state.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant={selectedTags.includes(tag.name) ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      selectedTags.includes(tag.name)
                        ? "bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/80 border-transparent"
                        : "border-[#333] text-muted-foreground hover:border-[#F7931A]/50 hover:text-foreground"
                    }`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name}
                    {selectedTags.includes(tag.name) && <X className="ml-1 h-3 w-3" />}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void handleAddNewTag() }
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
            opportunityCost={opportunityCost}
            currentPrice={currentPrice}
            onDelete={handleDelete}
            onEdit={() => setEditing(true)}
            canEdit={transaction.isDecrypted !== false && !systemFundingLeg}
            displayPayee={displayPayee}
            linkedIncome={linkedIncomePeer}
            onViewLinkedIncome={
              linkedIncomePeer
                ? () => {
                    if (onNavigateToLinkedIncome) {
                      onNavigateToLinkedIncome(linkedIncomePeer)
                    } else {
                      navigateTo("transactions", undefined, {
                        highlightTxnId: linkedIncomePeer.id,
                        envelopeFilter: linkedIncomePeer.envelopeId,
                      })
                      handleClose()
                    }
                  }
                : undefined
            }
            onDeleteDisabled={systemFundingLeg}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right">{value}</span>
    </div>
  )
}

function ViewMode({
  transaction,
  envelope,
  btcPrice,
  btcEquiv,
  btcValueToday,
  opportunityCost,
  currentPrice,
  onDelete,
  onEdit,
  canEdit,
  displayPayee,
  linkedIncome,
  onViewLinkedIncome,
  onDeleteDisabled,
}: {
  transaction: Transaction
  envelope?: { name: string; color: string; monthlyAllotment: number }
  btcPrice: number
  btcEquiv: number
  btcValueToday: number
  opportunityCost: number
  currentPrice: number | null
  onDelete: () => void
  onEdit: () => void
  canEdit: boolean
  displayPayee: string
  linkedIncome?: Transaction
  onViewLinkedIncome?: () => void
  onDeleteDisabled?: boolean
}) {
  const { state, recurringTransactions } = useApp()
  const recurringRule = transaction.recurringId
    ? recurringTransactions.find((rule) => rule.id === transaction.recurringId)
    : null
  const multiplier = transaction.amount > 0 && btcValueToday > 0 ? btcValueToday / transaction.amount : 0
  const gained = multiplier >= 1
  const showBtc = transaction.type === "expense" && btcPrice > 0

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Transaction details */}
      <div className="flex flex-col gap-3.5">
        <DetailRow
          label={transaction.source === "envelope_funding_in" ? "Description" : "Payee"}
          value={
            <span className="font-medium">
              {transaction.isDecrypted === false ? (
                <span className="text-muted-foreground italic">{ENCRYPTED_DISPLAY}</span>
              ) : (
                displayPayee
              )}
            </span>
          }
        />
        {linkedIncome && onViewLinkedIncome && (
          <DetailRow
            label="Income entry"
            value={
              <button
                type="button"
                onClick={onViewLinkedIncome}
                className="text-[#F7931A] hover:underline text-sm font-medium"
              >
                View {formatUsd(linkedIncome.amount)} on{" "}
                {state.envelopes.find((e) => e.id === linkedIncome.envelopeId)?.name ?? "Savings"}
              </button>
            }
          />
        )}
        <DetailRow
          label="Date"
          value={formatTransactionDetailDateTime(transaction.date)}
        />
        <DetailRow
          label="Type"
          value={
            <Badge
              variant="outline"
              className={typeBadgeClassForTransaction(transaction)}
            >
              {displayTypeLabelForTransaction(transaction)}
              {transaction.recurringId && (
                <span className="ml-1 inline-flex"><Repeat className="h-3 w-3" /></span>
              )}
            </Badge>
          }
        />
        {recurringRule && (
          <DetailRow
            label="Recurs"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
                {CADENCE_LABELS[recurringRule.cadence]}
              </span>
            }
          />
        )}
        <DetailRow
          label="Amount"
          value={<span className="font-semibold">{formatUsd(transaction.amount, 2)}</span>}
        />
        {envelope && (
          <DetailRow
            label="Envelope"
            value={
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: envelope.color }} />
                {envelope.name}
              </span>
            }
          />
        )}
        {transaction.tags.length > 0 && (
          <DetailRow
            label="Tags"
            value={
              <div className="flex flex-wrap gap-1 justify-end">
                {transaction.tags.map((tag) => (
                  <span key={tag} className="text-xs bg-[#1A1A1A] text-muted-foreground px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            }
          />
        )}
        {transaction.notes && (
          <DetailRow
            label="Notes"
            value={
              <span className="text-sm text-muted-foreground italic">
                {transaction.isDecrypted === false ? ENCRYPTED_DISPLAY : transaction.notes}
              </span>
            }
          />
        )}
      </div>

      {/* BTC section */}
      {state.opportunityCostEnabled && showBtc && (
        <div className="rounded-xl border border-[#F7931A]/30 bg-[#F7931A]/5 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-0.5">
            <Bitcoin className="h-3.5 w-3.5 text-[#F7931A]" />
            <span className="text-xs font-medium text-[#F7931A] uppercase tracking-wider">Bitcoin</span>
          </div>

          <DetailRow label="Price at time" value={formatUsd(btcPrice)} />

          <DetailRow
            label="Could have stacked"
            value={
              <span className="font-medium">
                <FormattedBtcAmount btcValue={btcEquiv} unit={state.btcDisplayUnit} />
              </span>
            }
          />

          {currentPrice && (
            <DetailRow
              label="Value today"
              value={
                <span className={`font-semibold ${gained ? "text-[#F7931A]" : "text-[#22C55E]"}`}>
                  {formatUsd(btcValueToday, 2)}
                  <span className="ml-1.5 text-xs font-normal opacity-80">
                    ({gained ? "+" : ""}{((multiplier - 1) * 100).toFixed(0)}%)
                  </span>
                </span>
              }
            />
          )}

          {currentPrice && showBtc && (
            <DetailRow
              label="Opportunity cost"
              value={
                <span
                  className={`font-semibold ${
                    opportunityCost > 0
                      ? "text-[#F7931A]"
                      : opportunityCost < 0
                        ? "text-[#22C55E]"
                        : "text-foreground"
                  }`}
                  title="What you’d be up or down in USD vs. spending: value of that BTC today minus the original spend."
                >
                  {opportunityCost > 0 ? "+" : ""}
                  {formatUsd(opportunityCost, 2)}
                </span>
              }
            />
          )}
        </div>
      )}

      <div className="flex items-center border-t border-[#1A1A1A] mt-1 -mx-6">
        <button
          type="button"
          onClick={onEdit}
          disabled={!canEdit}
          title={!canEdit ? "Unlock encryption to edit payee and notes" : undefined}
          className="flex-1 flex items-center justify-center gap-1.5 py-4 text-xs text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
        <div className="w-px h-5 bg-[#1A1A1A]" />
        <button
          onClick={onDelete}
          disabled={onDeleteDisabled}
          title={onDeleteDisabled ? "Income allocation rows are managed by your Income entry" : undefined}
          className="flex-1 flex items-center justify-center gap-1.5 py-4 text-xs text-muted-foreground hover:text-[#EF4444] hover:bg-[#1A1A1A] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>
    </div>
  )
}
