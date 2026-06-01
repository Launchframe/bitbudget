"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

type RecurringRule = {
  id: string
  kind: string
  frequency: string
  enabled: boolean
  nextRunAt: string
}

export function RecurringRulesSettings() {
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

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading recurring rules…</p>
  }

  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recurring rules yet. Schedule one from Move Funds or when adding extra income.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[#333] p-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium capitalize">
              {rule.kind.replace(/_/g, " ")} · {rule.frequency.replace(/_/g, " ")}
            </p>
            <p className="text-xs text-muted-foreground">
              Next: {new Date(rule.nextRunAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={rule.enabled}
              onCheckedChange={(checked) => void setEnabled(rule.id, checked)}
              aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void remove(rule.id)}>
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
