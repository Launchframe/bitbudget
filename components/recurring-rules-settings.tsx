"use client"

import { useCallback, useEffect, useState } from "react"
import { useApp } from "@/lib/app-context"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { IrregularIncomeDialog } from "@/components/irregular-income-dialog"
import { setOpenRebalanceIntent } from "@/lib/settings-navigation-intents"
import { CalendarClock } from "lucide-react"

type RecurringRule = {
  id: string
  kind: string
  frequency: string
  enabled: boolean
  nextRunAt: string
}

export function RecurringRulesSettings() {
  const { navigateTo } = useApp()
  const [rules, setRules] = useState<RecurringRule[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/recurring-rules")
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.rules)) {
        setRules(data.rules)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (id: string) => {
    await fetch(`/api/recurring-rules?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    await load()
  }

  const setEnabled = async (id: string, enabled: boolean) => {
    const res = await fetch("/api/recurring-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    })
    if (res.ok) {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)))
    } else {
      await load()
    }
  }

  return (
    <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6 min-w-0 w-full max-w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#3B82F6]/10">
          <CalendarClock className="h-5 w-5 text-[#3B82F6]" aria-hidden />
        </div>
        <h4 className="text-lg font-semibold text-foreground">Recurring rules</h4>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Schedule automatic envelope rebalances or income distributions on a cadence you choose.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading recurring rules…</p>
      ) : rules.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            No recurring rules yet. Create one when you rebalance envelopes or record extra income.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="border-[#333] bg-[#1A1A1A] hover:bg-[#222]"
              onClick={() => {
                setOpenRebalanceIntent()
                navigateTo("envelopes")
              }}
            >
              Rebalance envelopes
            </Button>
            <IrregularIncomeDialog
              triggerVariant="button"
              triggerLabel="Add income"
              triggerClassName="border-[#333] bg-[#1A1A1A] hover:bg-[#222]"
            />
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[#333] p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {rule.kind === "rebalance" || rule.kind === "move_funds"
                    ? "Rebalance Envelopes"
                    : "Income distribution"}{" "}
                  · {rule.frequency.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Next run {new Date(rule.nextRunAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(v) => void setEnabled(rule.id, v)}
                  aria-label={`Enable rule ${rule.id}`}
                />
                <button
                  type="button"
                  className="text-xs text-red-400 hover:underline"
                  onClick={() => void remove(rule.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && rules.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap border-t border-[#1F1F1F] pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#333] bg-[#1A1A1A] hover:bg-[#222]"
            onClick={() => {
              setOpenRebalanceIntent()
              navigateTo("envelopes")
            }}
          >
            Rebalance envelopes
          </Button>
          <IrregularIncomeDialog
            triggerVariant="button"
            triggerLabel="Add income"
            triggerClassName="border-[#333] bg-[#1A1A1A] hover:bg-[#222] h-9"
          />
        </div>
      )}
    </div>
  )
}
