"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Inbox,
  Mic,
  Camera,
  MessageSquare,
  Bell,
  Mail,
  Building2,
  Wallet,
  TrendingUp,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  X,
  CheckCheck,
  Copy,
  Sparkles,
  FileUp,
  FileText,
  ArrowRight,
  ShoppingBag,
} from "lucide-react"
import { useApp } from "@/lib/app-context"
import type { TransactionSource } from "@/lib/data"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface PendingStatementBatchTile {
  id: string
  source: string
  institutionName: string | null
  format: string
  dateFrom: string | null
  dateTo: string | null
  transactionCount: number
  createdAt: string
}

const sourceIcons: Record<TransactionSource, React.ElementType> = {
  manual: Inbox,
  voice: Mic,
  receipt_scan: Camera,
  sms: MessageSquare,
  notification_forward: Bell,
  email_forward: Mail,
  email_scan: Mail,
  plaid: Building2,
  paycheck: Wallet,
  retro_paycheck: Wallet,
  irregular_income: TrendingUp,
  envelope_funding_out: ArrowUpFromLine,
  envelope_funding_in: ArrowDownToLine,
  income_import: TrendingUp,
  envelope_sweep: Sparkles,
  csv_import: FileUp,
  statement_import: FileText,
  deficit_cover: ArrowDownToLine,
  envelope_transfer_in: ArrowDownToLine,
  envelope_transfer_out: ArrowUpFromLine,
  btc_sale_conversion: ArrowDownToLine,
  loan_open: Building2,
  loan_roll: ArrowRight,
  loan_payoff: ArrowUpFromLine,
  loan_liquidation: ArrowUpFromLine,
  shopping_own_expense: ShoppingBag,
  shopping_advance_out: ShoppingBag,
  shopping_advance_recovery: ShoppingBag,
  shopping_repayment_expense: ShoppingBag,
  shopping_prepaid_out: ShoppingBag,
  shopping_prepaid_in: ShoppingBag,
  shopping_prepaid_apply: ShoppingBag,
  shopping_correction: ShoppingBag,
}

const sourceLabels: Record<TransactionSource, string> = {
  manual: "Manual",
  voice: "Voice",
  receipt_scan: "Receipt",
  sms: "SMS",
  notification_forward: "Bank alert",
  email_forward: "Email",
  email_scan: "Email Scan",
  plaid: "Bank",
  paycheck: "Paycheck",
  retro_paycheck: "Missed paycheck",
  irregular_income: "Irregular income",
  envelope_funding_out: "Funding (Savings)",
  envelope_funding_in: "Funding (envelope)",
  income_import: "Past income",
  envelope_sweep: "Envelope sweep",
  csv_import: "CSV import",
  statement_import: "Statement",
  deficit_cover: "Cover from Savings",
  envelope_transfer_in: "Transfer in",
  envelope_transfer_out: "Transfer out",
  btc_sale_conversion: "Bitcoin sale",
  loan_open: "Loan opened",
  loan_roll: "Loan rolled over",
  loan_payoff: "Loan paid off",
  loan_liquidation: "Loan liquidated",
  shopping_own_expense: "Shared shopping",
  shopping_advance_out: "Shared shopping",
  shopping_advance_recovery: "Shared shopping",
  shopping_repayment_expense: "Shared shopping",
  shopping_prepaid_out: "Shared shopping",
  shopping_prepaid_in: "Shared shopping",
  shopping_prepaid_apply: "Shared shopping",
  shopping_correction: "Shared shopping",
}

export function ReviewInbox() {
  const { pendingTransactions, confirmPending, dismissPending, state, activeEnvelopes, addTag, refreshData, openStatementImporter } = useApp()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEnvelopeId, setEditEnvelopeId] = useState<string>("")
  const [editPayee, setEditPayee] = useState("")
  const [editAmount, setEditAmount] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [draftTagsById, setDraftTagsById] = useState<Record<string, string[]>>({})
  const [tagDraftById, setTagDraftById] = useState<Record<string, string>>({})
  const [tagCreatingById, setTagCreatingById] = useState<Record<string, boolean>>({})
  const [receiptInboxAddress, setReceiptInboxAddress] = useState<string | null>(null)
  const [copiedReceiptAddress, setCopiedReceiptAddress] = useState(false)
  const [pendingStatementBatches, setPendingStatementBatches] = useState<PendingStatementBatchTile[]>([])

  useEffect(() => {
    let cancelled = false
    async function loadReceiptInbox() {
      try {
        const res = await fetch("/api/user/receipt-inbox")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setReceiptInboxAddress(data.receiptInboxAddress ?? null)
      } catch {
        // best-effort onboarding helper
      }
    }
    async function loadPendingStatementBatches() {
      try {
        const res = await fetch("/api/import/pending-statements")
        if (!res.ok) return
        const data = await res.json() as PendingStatementBatchTile[]
        if (!cancelled) setPendingStatementBatches(data)
      } catch {
        // best-effort
      }
    }
    loadReceiptInbox()
    loadPendingStatementBatches()
    return () => {
      cancelled = true
    }
  }, [])

  const confirmableCount = pendingTransactions.filter(
    (pt) => pt.suggestedEnvelopeId,
  ).length

  const editingPending = useMemo(
    () => pendingTransactions.find((pt) => pt.id === editingId) ?? null,
    [pendingTransactions, editingId],
  )

  useEffect(() => {
    if (!editingPending) return
    setEditPayee(editingPending.payee)
    setEditAmount(String(editingPending.amount))
    setEditDate(editingPending.date)
    setEditNotes(editingPending.notes ?? "")
    setEditEnvelopeId(editingPending.suggestedEnvelopeId ?? "")
  }, [editingPending])

  function getDraftTags(ptId: string) {
    const draft = draftTagsById[ptId]
    if (draft) return draft
    const current = pendingTransactions.find((pt) => pt.id === ptId)?.tags
    if (!current) return []
    try {
      const parsed = JSON.parse(current)
      return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []
    } catch {
      return []
    }
  }

  function toggleTag(ptId: string, tag: string) {
    setDraftTagsById((prev) => {
      const current = prev[ptId] ?? getDraftTags(ptId)
      const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
      return { ...prev, [ptId]: next }
    })
  }

  async function createAndApplyTag(ptId: string) {
    const raw = tagDraftById[ptId] ?? ""
    const trimmed = raw.trim()
    if (!trimmed || tagCreatingById[ptId]) return

    if (state.tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())) {
      setDraftTagsById((prev) => {
        const current = prev[ptId] ?? getDraftTags(ptId)
        return current.includes(trimmed) ? prev : { ...prev, [ptId]: [...current, trimmed] }
      })
      setTagDraftById((prev) => ({ ...prev, [ptId]: "" }))
      return
    }

    setTagCreatingById((prev) => ({ ...prev, [ptId]: true }))
    try {
      await addTag(trimmed)
      await refreshData()
      setDraftTagsById((prev) => {
        const current = prev[ptId] ?? getDraftTags(ptId)
        return current.includes(trimmed) ? prev : { ...prev, [ptId]: [...current, trimmed] }
      })
      setTagDraftById((prev) => ({ ...prev, [ptId]: "" }))
    } finally {
      setTagCreatingById((prev) => ({ ...prev, [ptId]: false }))
    }
  }

  async function copyReceiptInboxAddress() {
    if (!receiptInboxAddress) return
    await navigator.clipboard.writeText(receiptInboxAddress)
    setCopiedReceiptAddress(true)
    window.setTimeout(() => setCopiedReceiptAddress(false), 1500)
  }

  if (pendingTransactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 bg-[#0D0D0D] rounded-2xl">
        <div className="p-4 rounded-full bg-[#F7931A]/10">
          <Inbox className="h-6 w-6 text-[#F7931A]" />
        </div>
        <p className="text-foreground font-semibold text-lg">All caught up!</p>
        <p className="text-muted-foreground text-sm">No pending transactions to review.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4" data-walkthrough="review-list">
      {/* Header */}
      <div className="flex items-center justify-between" data-walkthrough="review-header">
        <h2 className="text-xl font-bold text-foreground">Review Inbox</h2>
        {confirmableCount > 0 && (
          <button
            onClick={async () => {
              for (const pt of pendingTransactions) {
                if (pt.suggestedEnvelopeId) {
                  await confirmPending(pt.id, pt.suggestedEnvelopeId, { tags: getDraftTags(pt.id) })
                }
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors"
          >
            <CheckCheck className="h-4 w-4" />
            Confirm {confirmableCount} with suggestion{confirmableCount !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">
        {pendingTransactions.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-5">
            <div>
              <p className="text-foreground font-semibold text-lg">No pending transactions yet</p>
              <p className="text-muted-foreground text-sm mt-1">
                Forward a receipt to your unique inbox to get it here for review.
              </p>
            </div>
            <div className="w-full rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Receipt inbox</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-sm text-foreground break-all">
                  {receiptInboxAddress || "Loading..."}
                </p>
                <button
                  type="button"
                  onClick={() => void copyReceiptInboxAddress()}
                  disabled={!receiptInboxAddress}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-[#555] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copiedReceiptAddress ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedReceiptAddress ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        ) : pendingTransactions.map((pt) => {
          const SourceIcon = sourceIcons[pt.source] || Inbox
          const envelope = state.envelopes.find(e => e.id === pt.suggestedEnvelopeId)
          const isEditing = editingId === pt.id

          return (
            <div key={pt.id} className="bg-[#0D0D0D] rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[#1A1A1A]">
                    <SourceIcon className="h-4 w-4 text-[#F7931A]" />
                  </div>
                  <div>
                    <p className="text-foreground font-medium">{pt.payee}</p>
                    <p className="text-muted-foreground text-xs">
                      {sourceLabels[pt.source]} · {pt.date}
                    </p>
                  </div>
                </div>
                <p
                  className={`font-semibold text-lg tabular-nums ${
                    pt.type === "credit" ? "text-[#22C55E]" : "text-foreground"
                  }`}
                >
                  {pt.type === "credit" ? "+" : ""}${pt.amount.toFixed(2)}
                  {pt.type === "credit" ? (
                    <span className="ml-1 text-[11px] font-medium text-[#22C55E]/80">
                      Money in
                    </span>
                  ) : null}
                </p>
              </div>

              {/* Envelope + Confidence */}
              <div className="flex items-center gap-2">
                {envelope ? (
                  <span className="text-xs px-2 py-1 rounded-lg bg-[#1A1A1A] text-muted-foreground">
                    {envelope.name}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-lg bg-[#1A1A1A] text-[#F7931A]">
                    No envelope suggested
                  </span>
                )}
                <div className="flex items-center gap-1 ml-auto">
                  <div className="w-16 h-1.5 rounded-full bg-[#1A1A1A] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pt.confidence * 100}%`,
                        backgroundColor: pt.confidence >= 0.75 ? "#22c55e" : pt.confidence >= 0.5 ? "#F7931A" : "#ef4444",
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(pt.confidence * 100)}%
                  </span>
                </div>
              </div>

              {/* Quick tags */}
              <div className="flex flex-wrap items-center gap-2">
                {state.tags.map((tag) => {
                  const tagName = tag.name
                  const selected = getDraftTags(pt.id).includes(tagName)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(pt.id, tagName)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        selected
                          ? "bg-[#F7931A] text-[#0D0D0D] border-[#F7931A]"
                          : "bg-[#1A1A1A] text-muted-foreground border-[#333] hover:text-foreground"
                      }`}
                    >
                      {tagName}
                    </button>
                  )
                })}
                <div className="flex items-center gap-2 rounded-full border border-dashed border-[#333] bg-[#111111] px-2.5 py-1">
                  <input
                    value={tagDraftById[pt.id] ?? ""}
                    onChange={(e) => setTagDraftById((prev) => ({ ...prev, [pt.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void createAndApplyTag(pt.id)
                      }
                    }}
                    placeholder="New tag"
                    aria-label="New tag name"
                    className="w-20 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void createAndApplyTag(pt.id)
                    }}
                    disabled={tagCreatingById[pt.id] || !(tagDraftById[pt.id]?.trim())}
                    className="inline-flex h-6 items-center justify-center rounded-full bg-[#F7931A] px-2 text-[10px] font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Envelope edit mode */}
              {isEditing && (
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Payee</Label>
                  <input
                    value={editPayee}
                    onChange={(e) => setEditPayee(e.target.value)}
                    className="bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg px-3 py-2 text-sm"
                  />
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Amount</Label>
                  <input
                    type="number"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg px-3 py-2 text-sm"
                  />
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Date</Label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg px-3 py-2 text-sm"
                  />
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Notes</Label>
                  <input
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg px-3 py-2 text-sm"
                  />
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelope</Label>
                  <Select value={editEnvelopeId || undefined} onValueChange={(v) => setEditEnvelopeId(v)}>
                    <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                      <SelectValue placeholder="Select an envelope" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1A1A1A] border-[#333]">
                      {activeEnvelopes.map((env) => (
                        <SelectItem key={env.id} value={env.id} className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: env.color }} />
                            {env.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => {
                        const nextAmount = Number.parseFloat(editAmount)
                        if (editEnvelopeId && editPayee.trim() && editDate && Number.isFinite(nextAmount) && nextAmount > 0) {
                          confirmPending(pt.id, editEnvelopeId, {
                            payee: editPayee.trim(),
                            amount: nextAmount,
                            date: editDate,
                            notes: editNotes.trim() ? editNotes.trim() : null,
                            tags: getDraftTags(pt.id),
                          })
                          setEditingId(null)
                        }
                      }}
                      disabled={!editEnvelopeId || !editPayee.trim() || !editDate || !Number.isFinite(Number.parseFloat(editAmount)) || Number.parseFloat(editAmount) <= 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-xs font-semibold hover:bg-[#F7931A]/90 disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" /> Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-muted-foreground text-xs hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (pt.suggestedEnvelopeId) {
                          confirmPending(pt.id, pt.suggestedEnvelopeId, { tags: getDraftTags(pt.id) })
                        } else {
                          setEditingId(pt.id)
                          setEditEnvelopeId("")
                          setEditPayee(pt.payee)
                          setEditAmount(String(pt.amount))
                          setEditDate(pt.date)
                          setEditNotes(pt.notes ?? "")
                          setDraftTagsById((prev) => ({
                            ...prev,
                            [pt.id]: getDraftTags(pt.id),
                          }))
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-xs font-semibold hover:bg-[#F7931A]/90"
                    >
                      <Check className="h-3 w-3" /> Confirm
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(pt.id)
                        setEditEnvelopeId(pt.suggestedEnvelopeId ?? "")
                        setEditPayee(pt.payee)
                        setEditAmount(String(pt.amount))
                        setEditDate(pt.date)
                        setEditNotes(pt.notes ?? "")
                        setDraftTagsById((prev) => ({
                          ...prev,
                          [pt.id]: getDraftTags(pt.id),
                        }))
                      }}
                      className="px-3 py-1.5 text-muted-foreground text-xs hover:text-foreground border border-[#333] rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => dismissPending(pt.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground text-xs hover:text-red-400 ml-auto"
                    >
                      <X className="h-3 w-3" /> Dismiss
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pending statement batches from email forwarding */}
      {pendingStatementBatches.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider px-1">
            Statements to review
          </h3>
          {pendingStatementBatches.map((batch) => (
            <div
              key={batch.id}
              className="rounded-xl bg-[#1A1A1A] border border-[#252525] p-4 space-y-2"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-btc-orange/10 shrink-0">
                  <FileText className="h-4 w-4 text-btc-orange" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {batch.institutionName ? `${batch.institutionName} Statement` : "Bank Statement"}
                    {batch.dateFrom ? ` · ${batch.dateFrom.slice(0, 7)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {batch.transactionCount} transaction{batch.transactionCount !== 1 ? "s" : ""}
                    {" · "}
                    {new Date(batch.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    openStatementImporter({ pendingBatchId: batch.id })
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-btc-orange text-[#0D0D0D] rounded-lg text-xs font-semibold"
                >
                  Review & Import <ArrowRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await fetch(`/api/import/pending-batch/${batch.id}`, { method: "DELETE" })
                      setPendingStatementBatches(prev => prev.filter(b => b.id !== batch.id))
                    } catch {}
                  }}
                  className="px-3 py-1.5 text-muted-foreground text-xs hover:text-red-400"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
