"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { useApp } from "@/lib/app-context"

interface ParsedVoiceResult {
  payee: string
  amount: number
  envelopeId: string | null
  envelopeName: string | null
  date: string
}

interface VoiceConfirmationCardProps {
  result: ParsedVoiceResult
  onDismiss: () => void
}

export function VoiceConfirmationCard({ result, onDismiss }: VoiceConfirmationCardProps) {
  const { addTransaction, state } = useApp()
  const [payee, setPayee] = useState(result.payee)
  const [amount, setAmount] = useState(result.amount.toString())
  const [envelopeId, setEnvelopeId] = useState(result.envelopeId ?? "")
  const [date, setDate] = useState(result.date)

  const handleConfirm = () => {
    if (!payee || !amount || !envelopeId) return
    addTransaction({
      date,
      payee,
      amount: parseFloat(amount),
      type: "expense",
      envelopeId,
      tags: [],
    })
    onDismiss()
  }

  const activeEnvelopes = state.envelopes.filter((e) => !e.archived)

  return (
    <div className="mt-3 bg-[#0D0D0D] border border-[#333] rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#F7931A] uppercase tracking-wide">
          Voice Result
        </span>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase">Payee</label>
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            className="bg-[#1A1A1A] border border-[#333] rounded-lg px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase">Amount</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            className="bg-[#1A1A1A] border border-[#333] rounded-lg px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase">Envelope</label>
          <select
            value={envelopeId}
            onChange={(e) => setEnvelopeId(e.target.value)}
            className="bg-[#1A1A1A] border border-[#333] rounded-lg px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="">Select...</option>
            {activeEnvelopes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase">Date</label>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            className="bg-[#1A1A1A] border border-[#333] rounded-lg px-2.5 py-1.5 text-sm text-foreground"
          />
        </div>
      </div>

      <button
        onClick={handleConfirm}
        disabled={!payee || !amount || !envelopeId}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
        Add Transaction
      </button>
    </div>
  )
}
