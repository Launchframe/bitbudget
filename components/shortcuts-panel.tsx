"use client"

import { useState, useEffect, useMemo } from "react"
import { Zap, Search } from "lucide-react"
import { useApp } from "@/lib/app-context"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface TransactionShortcut {
  id: string
  payee: string
  defaultAmount: number | null
  envelopeId: string
  label: string | null
  usageCount: number
}

const SHORTCUTS_INLINE_MAX = 10

export function useTransactionShortcuts(dialogOpen: boolean): TransactionShortcut[] {
  const [shortcuts, setShortcuts] = useState<TransactionShortcut[]>([])

  useEffect(() => {
    if (dialogOpen) {
      fetch("/api/shortcuts")
        .then((r) => (r.ok ? r.json() : []))
        .then(setShortcuts)
    }
  }, [dialogOpen])

  return shortcuts
}

function shortcutSearchText(s: TransactionShortcut): string {
  return `${s.label ?? ""} ${s.payee}`.toLowerCase()
}

export function ShortcutsPanel({ shortcuts }: { shortcuts: TransactionShortcut[] }) {
  const { openNewTransaction } = useApp()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [query, setQuery] = useState("")

  const handleUse = (s: TransactionShortcut) => {
    fetch("/api/shortcuts/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id }),
    })
    setSheetOpen(false)
    setQuery("")
    openNewTransaction({
      payee: s.payee,
      amount: s.defaultAmount?.toString() ?? "",
      envelopeId: s.envelopeId,
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shortcuts
    return shortcuts.filter((s) => shortcutSearchText(s).includes(q))
  }, [shortcuts, query])

  if (shortcuts.length === 0) return null

  const inline = shortcuts.slice(0, SHORTCUTS_INLINE_MAX)
  const overflow = shortcuts.length > SHORTCUTS_INLINE_MAX

  const chipClass =
    "flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] border border-[#333] rounded-xl text-xs text-foreground hover:border-[#F7931A]/50 transition-colors shrink-0 text-left"

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-[#F7931A]" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shortcuts
        </span>
        {overflow && (
          <span className="text-[10px] text-muted-foreground">({shortcuts.length})</span>
        )}
      </div>
      <div
        className={cn(
          "flex max-h-32 flex-wrap gap-2 overflow-y-auto pb-1",
          !overflow && "flex-nowrap overflow-x-auto no-scrollbar",
        )}
      >
        {inline.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handleUse(s)}
            className={cn(chipClass, !overflow && "whitespace-nowrap")}
          >
            <span>{s.label || s.payee}</span>
            {s.defaultAmount != null && (
              <span className="text-muted-foreground">${s.defaultAmount.toFixed(2)}</span>
            )}
          </button>
        ))}
        {overflow && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              chipClass,
              "border-dashed text-muted-foreground hover:text-foreground",
            )}
          >
            Show all…
          </button>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="bottom-0 left-0 right-0 top-auto flex max-h-[min(70dvh,520px)] flex-col rounded-t-2xl border-2 border-b-0 border-[#333] bg-[#0D0D0D] text-foreground"
        >
          <SheetHeader className="shrink-0 border-b border-[#333] pb-4 pr-12 text-left">
            <SheetTitle className="text-foreground">All shortcuts</SheetTitle>
          </SheetHeader>
          <div className="relative mt-3 shrink-0 px-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or payee…"
              className="border-[#333] bg-[#1A1A1A] pl-9 text-foreground placeholder:text-[#555]"
              autoComplete="off"
            />
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-1 pb-6">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No matches</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handleUse(s)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-3 text-left hover:border-[#333] hover:bg-[#1A1A1A]"
                    >
                      <span className="text-sm text-foreground">
                        {s.label || s.payee}
                        {s.label && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {s.payee}
                          </span>
                        )}
                      </span>
                      {s.defaultAmount != null && (
                        <span className="shrink-0 text-sm text-muted-foreground">
                          ${s.defaultAmount.toFixed(2)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
