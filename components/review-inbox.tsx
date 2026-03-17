"use client"

import { useState } from "react"
import { Inbox, Mic, Camera, MessageSquare, Mail, Building2, Check, X, CheckCheck } from "lucide-react"
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

const sourceIcons: Record<TransactionSource, React.ElementType> = {
  manual: Inbox,
  voice: Mic,
  receipt_scan: Camera,
  sms: MessageSquare,
  email_forward: Mail,
  email_scan: Mail,
  plaid: Building2,
}

const sourceLabels: Record<TransactionSource, string> = {
  manual: "Manual",
  voice: "Voice",
  receipt_scan: "Receipt",
  sms: "SMS",
  email_forward: "Email",
  email_scan: "Email Scan",
  plaid: "Bank",
}

export function ReviewInbox() {
  const { pendingTransactions, confirmPending, dismissPending, confirmAllPending, state, activeEnvelopes } = useApp()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEnvelopeId, setEditEnvelopeId] = useState<string>("")

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

  const confirmableCount = pendingTransactions.filter(
    (pt) => pt.suggestedEnvelopeId,
  ).length

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Review Inbox</h2>
        {confirmableCount > 0 && (
          <button
            onClick={confirmAllPending}
            className="flex items-center gap-2 px-4 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors"
          >
            <CheckCheck className="h-4 w-4" />
            Confirm {confirmableCount} with suggestion{confirmableCount !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">
        {pendingTransactions.map((pt) => {
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
                <p className="text-foreground font-semibold text-lg">
                  ${pt.amount.toFixed(2)}
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

              {/* Envelope edit mode */}
              {isEditing && (
                <div className="flex flex-col gap-2">
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
                        if (editEnvelopeId) {
                          confirmPending(pt.id, editEnvelopeId)
                          setEditingId(null)
                        }
                      }}
                      disabled={!editEnvelopeId}
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
                          confirmPending(pt.id)
                        } else {
                          setEditingId(pt.id)
                          setEditEnvelopeId("")
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
    </div>
  )
}
