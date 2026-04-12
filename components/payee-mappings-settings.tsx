"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  buildPayeeDisplayRowsFromTransactions,
  findSimilarPayeeClusters,
  normalizePayeeKey,
  type PayeeNameCluster,
  type PayeeNameVariant,
} from "@/lib/payee-canonical"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, Link2, Loader2 } from "lucide-react"

type AliasRow = { id: string; sourceNormalized: string; canonicalPayee: string }

export function PayeeMappingsSettings() {
  const { activeTransactions } = useApp()
  const [aliases, setAliases] = useState<AliasRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newSource, setNewSource] = useState("")
  const [newCanonical, setNewCanonical] = useState("")
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [clusterBusyKey, setClusterBusyKey] = useState<string | null>(null)

  const payeeRows = useMemo(
    () => buildPayeeDisplayRowsFromTransactions(activeTransactions),
    [activeTransactions],
  )

  const distinctPayeeNames = useMemo(() => {
    const names = [...new Set(payeeRows.map((r) => r.displayName))]
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  }, [payeeRows])

  const clusters = useMemo(() => findSimilarPayeeClusters(payeeRows), [payeeRows])

  const loadAliases = useCallback(() => {
    setLoading(true)
    fetch("/api/payee-aliases")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AliasRow[]) => setAliases(Array.isArray(rows) ? rows : []))
      .catch(() => setAliases([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadAliases()
  }, [loadAliases])

  async function handleAddMapping(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const src = newSource.trim()
    const canon = newCanonical.trim()
    if (!src || !canon) {
      setFormError("Enter both the import text and the canonical payee name.")
      return
    }
    setFormBusy(true)
    try {
      const res = await fetch("/api/payee-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel: src, canonicalPayee: canon }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setFormError(typeof err.error === "string" ? err.error : "Could not save")
        return
      }
      setNewSource("")
      setNewCanonical("")
      loadAliases()
    } finally {
      setFormBusy(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/payee-aliases?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (res.ok) loadAliases()
  }

  /** Map every variant in the cluster to the chosen canonical payee (skips identical names). */
  async function applyClusterMappings(cluster: PayeeNameCluster, canonicalDisplay: string) {
    setFormError(null)
    const key = cluster.softKey
    setClusterBusyKey(key)
    try {
      for (const v of cluster.variants) {
        if (normalizePayeeKey(v.displayName) === normalizePayeeKey(canonicalDisplay)) continue
        const res = await fetch("/api/payee-aliases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceLabel: v.displayName,
            canonicalPayee: canonicalDisplay,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setFormError(typeof err.error === "string" ? err.error : "Some mappings failed")
          break
        }
      }
      loadAliases()
    } finally {
      setClusterBusyKey(null)
    }
  }

  function displaySource(a: AliasRow): string {
    const hit = distinctPayeeNames.find((n) => normalizePayeeKey(n) === a.sourceNormalized)
    return hit ?? a.sourceNormalized
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Payee name mappings</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Imports (receipt scan, CSV, bank text) may spell the same merchant differently than your manual
          entries. <span className="text-foreground">Your canonical payee</span> is the name stored on
          transactions after a match—reports and lists group by that string. You decide every mapping:
          similar spellings are only merged automatically when they differ by spaces or punctuation (e.g.
          Wal-Mart vs Walmart). Names like <span className="text-foreground">Walmart</span> and{" "}
          <span className="text-foreground">Walmart Liquor</span> stay separate unless you add a mapping.
        </p>
      </div>

      <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6">
        <div className="flex items-center gap-2 text-foreground">
          <Link2 className="h-4 w-4 text-btc-orange" />
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Similar spellings in your data
          </h4>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          These groups share the same letters (ignoring spaces and hyphens). Pick one canonical name to map
          the others to, or leave them separate if they are different businesses for you.
        </p>
        {clusters.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No spelling-only duplicates found.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {clusters.map((cluster) => (
              <ClusterRow
                key={cluster.softKey}
                cluster={cluster}
                busy={clusterBusyKey === cluster.softKey}
                onApply={(canonical) => void applyClusterMappings(cluster, canonical)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6">
        <h4 className="text-sm font-semibold text-foreground">Saved mappings</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          When an import matches the left text, BitBudget uses the right payee. Existing transactions are not
          rewritten—only new imports and scans.
        </p>
        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : aliases.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No saved mappings yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[#1F1F1F] border border-[#333] rounded-lg overflow-hidden">
            {aliases.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-[#1A1A1A] px-4 py-3"
              >
                <div className="text-sm">
                  <span className="text-muted-foreground">From </span>
                  <span className="font-medium text-foreground">{displaySource(a)}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-medium text-foreground">{a.canonicalPayee}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(a.id)}
                  className="rounded-md p-2 text-muted-foreground hover:bg-[#252525] hover:text-red-400"
                  title="Remove mapping"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => void handleAddMapping(e)}
        className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6"
      >
        <h4 className="text-sm font-semibold text-foreground">Add mapping</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          e.g. import text <span className="text-foreground">WM SUPERCENTER</span> → canonical{" "}
          <span className="text-foreground">Walmart</span>
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="payee-map-source">Import / statement text</Label>
            <Input
              id="payee-map-source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              placeholder="As it appears on receipts or CSV"
              className="border-[#333] bg-[#1A1A1A] text-foreground"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payee-map-canonical">Canonical payee name</Label>
            <Input
              id="payee-map-canonical"
              value={newCanonical}
              onChange={(e) => setNewCanonical(e.target.value)}
              placeholder="How you want it in BitBudget"
              className="border-[#333] bg-[#1A1A1A] text-foreground"
              list="payee-canonical-options"
              autoComplete="off"
            />
            <datalist id="payee-canonical-options">
              {distinctPayeeNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        </div>
        {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
        <button
          type="submit"
          disabled={formBusy}
          className="mt-4 rounded-lg bg-btc-orange px-4 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-btc-orange/90 disabled:opacity-50"
        >
          {formBusy ? "Saving…" : "Save mapping"}
        </button>
      </form>
    </div>
  )
}

function ClusterRow({
  cluster,
  busy,
  onApply,
}: {
  cluster: PayeeNameCluster
  busy: boolean
  onApply: (canonical: string) => void
}) {
  const [canonicalPick, setCanonicalPick] = useState(cluster.variants[0]?.displayName ?? "")

  return (
    <li className="rounded-lg border border-[#333] bg-[#1A1A1A] p-4">
      <ul className="flex flex-wrap gap-2 text-sm">
        {cluster.variants.map((v: PayeeNameVariant) => (
          <li
            key={v.normalized}
            className="rounded-md border border-[#333] bg-[#0D0D0D] px-2 py-1 text-foreground"
          >
            {v.displayName}{" "}
            <span className="text-muted-foreground">({v.count} tx)</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Canonical payee for this group</Label>
          <select
            value={canonicalPick}
            onChange={(e) => setCanonicalPick(e.target.value)}
            className="rounded-md border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-foreground"
          >
            {cluster.variants.map((v) => (
              <option key={v.normalized} value={v.displayName}>
                {v.displayName} ({v.count} tx)
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy || !canonicalPick}
          onClick={() => onApply(canonicalPick)}
          className="rounded-lg border border-[#333] bg-[#252525] px-3 py-2 text-sm font-medium text-foreground hover:bg-[#333] disabled:opacity-50"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Map variants to canonical"
          )}
        </button>
      </div>
    </li>
  )
}
