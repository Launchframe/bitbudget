"use client"

import { useState, useEffect } from "react"
import { Zap } from "lucide-react"
import { useApp } from "@/lib/app-context"

interface Shortcut {
  id: string
  payee: string
  defaultAmount: number | null
  envelopeId: string
  label: string | null
  usageCount: number
}

export function ShortcutsPanel({ dialogOpen }: { dialogOpen: boolean }) {
  const { openNewTransaction } = useApp()
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([])

  useEffect(() => {
    if (dialogOpen) {
      fetch("/api/shortcuts")
        .then((r) => (r.ok ? r.json() : []))
        .then(setShortcuts)
    }
  }, [dialogOpen])

  if (shortcuts.length === 0) return null

  const handleUse = async (s: Shortcut) => {
    fetch("/api/shortcuts/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id }),
    })
    openNewTransaction({
      payee: s.payee,
      amount: s.defaultAmount?.toString() ?? "",
      envelopeId: s.envelopeId,
    })
  }

  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-[#F7931A]" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Shortcuts
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {shortcuts.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handleUse(s)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] border border-[#333] rounded-xl text-xs text-foreground hover:border-[#F7931A]/50 transition-colors whitespace-nowrap shrink-0"
          >
            <span>{s.label || s.payee}</span>
            {s.defaultAmount != null && (
              <span className="text-muted-foreground">${s.defaultAmount.toFixed(2)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
