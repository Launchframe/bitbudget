"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  buildPayeeDisplayRowsFromTransactions,
  findSimilarPayeeClusters,
  getPayeeRuleReviewClusters,
  normalizePayeeKey,
  type PayeeNameCluster,
} from "@/lib/payee-canonical"
import {
  loadDismissedPayeeRules,
  addDismissedPayeeRules,
} from "@/lib/payee-rule-dismissals"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, Link2, Loader2, X, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type AliasRow = { id: string; sourceNormalized: string; canonicalPayee: string }

export function PayeeRulesSettings() {
  const { activeTransactions, currentUserId } = useApp()
  const [aliases, setAliases] = useState<AliasRow[]>([])
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [newSource, setNewSource] = useState("")
  const [newCanonical, setNewCanonical] = useState("")
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [clusterBusyKey, setClusterBusyKey] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const payeeRows = useMemo(
    () => buildPayeeDisplayRowsFromTransactions(activeTransactions),
    [activeTransactions],
  )

  const distinctPayeeNames = useMemo(() => {
    const names = [...new Set(payeeRows.map((r) => r.displayName))]
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  }, [payeeRows])

  const clusters = useMemo(() => findSimilarPayeeClusters(payeeRows), [payeeRows])
  const pendingClusters = useMemo(
    () => getPayeeRuleReviewClusters(clusters, aliases, ignored),
    [clusters, aliases, ignored],
  )

  const loadAliases = useCallback(() => {
    setLoading(true)
    fetch("/api/payee-rules")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AliasRow[]) => setAliases(Array.isArray(rows) ? rows : []))
      .catch(() => setAliases([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadAliases()
  }, [loadAliases])

  // Reload when the new-transaction dialog saves a rule so the list stays current.
  useEffect(() => {
    const handler = () => loadAliases()
    window.addEventListener("payee-rules-updated", handler)
    return () => window.removeEventListener("payee-rules-updated", handler)
  }, [loadAliases])

  useEffect(() => {
    setIgnored(loadDismissedPayeeRules(currentUserId))
  }, [currentUserId])

  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current)
    }
  }, [])

  function showSuccess(message: string) {
    if (successTimer.current) clearTimeout(successTimer.current)
    setSuccessMessage(message)
    successTimer.current = setTimeout(() => setSuccessMessage(null), 4000)
  }

  async function handleAddMapping(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const src = newSource.trim()
    const canon = newCanonical.trim()
    if (!src || !canon) {
      setFormError("Enter both the source payee and destination payee.")
      return
    }
    setFormBusy(true)
    try {
      const res = await fetch("/api/payee-rules", {
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
    const res = await fetch(`/api/payee-rules?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (res.ok) loadAliases()
  }

  /** Map every variant in the cluster to the chosen canonical payee (skips identical names). */
  async function applyClusterMappings(cluster: PayeeNameCluster, canonicalDisplay: string) {
    setFormError(null)
    setSuccessMessage(null)
    const key = cluster.softKey
    setClusterBusyKey(key)
    try {
      let savedCount = 0
      for (const v of cluster.variants) {
        if (normalizePayeeKey(v.displayName) === normalizePayeeKey(canonicalDisplay)) continue
        const res = await fetch("/api/payee-rules", {
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
          return
        }
        savedCount += 1
      }
      loadAliases()
      showSuccess(
        savedCount > 0
          ? `Mapped ${savedCount} source ${savedCount === 1 ? "payee" : "payees"} to ${canonicalDisplay}.`
          : `Mappings to ${canonicalDisplay} are already saved.`,
      )
    } finally {
      setClusterBusyKey(null)
    }
  }

  function handleDismissCluster(cluster: PayeeNameCluster) {
    if (!currentUserId) return
    const keys = cluster.variants.map((v) => v.normalized)
    addDismissedPayeeRules(currentUserId, keys)
    setIgnored((prev) => {
      const next = new Set(prev)
      for (const k of keys) next.add(k)
      return next
    })
  }

  function displaySource(a: AliasRow): string {
    const hit = distinctPayeeNames.find((n) => normalizePayeeKey(n) === a.sourceNormalized)
    return hit ?? a.sourceNormalized
  }

  return (
    <div className="relative flex flex-col gap-8">
      {successMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-btc-orange/35 bg-[#0D0D0D] px-4 py-3 text-sm text-foreground shadow-lg shadow-black/40"
        >
          {successMessage}
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold text-foreground">Payee name rules</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Imports (receipt scan, CSV, bank text) may spell the same merchant differently than your
          manual entries. Tap a spelling to choose which one to keep — the others will map to it
          automatically on future imports.
        </p>
      </div>

      {/* Similar spellings — suggestion cards */}
      <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-btc-orange" />
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Similar spellings in your data
          </h4>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          These groups share the same letters (ignoring spaces and hyphens). Tap a spelling to keep it;
          the rest will map to it. If they&apos;re different businesses, dismiss the card.
        </p>
        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading suggestions…
          </div>
        ) : pendingClusters.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No spelling-only duplicates found.</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pendingClusters.map((cluster) => (
              <ClusterCard
                key={cluster.softKey}
                cluster={cluster}
                busy={clusterBusyKey === cluster.softKey}
                onApply={(canonical) => void applyClusterMappings(cluster, canonical)}
                onDismiss={() => handleDismissCluster(cluster)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Saved mappings grid */}
      <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6">
        <h4 className="text-sm font-semibold text-foreground">Saved rules</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          When an import matches the left text, BitBudget uses the right payee. Existing transactions
          are not rewritten—only new imports and scans.
        </p>
        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : aliases.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No saved rules yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aliases.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-[#222] bg-[#111] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {displaySource(a)}
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground/60">→</span>
                    <p className="truncate text-xs text-muted-foreground">{a.canonicalPayee}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(a.id)}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-white/5 hover:text-red-400"
                  title="Remove rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual add form */}
      <form
        onSubmit={(e) => void handleAddMapping(e)}
        className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6"
      >
        <h4 className="text-sm font-semibold text-foreground">Add rule</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          e.g. Receipts from <span className="text-foreground">WM SUPERCENTER</span> → show up in your budget
          as <span className="text-foreground">Walmart</span>
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="payee-map-source">Source payee</Label>
            <Input
              id="payee-map-source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              placeholder="As it appears on receipts or statements"
              className="border-[#333] bg-[#1A1A1A] text-foreground"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payee-map-canonical">Destination payee</Label>
            <Input
              id="payee-map-canonical"
              value={newCanonical}
              onChange={(e) => setNewCanonical(e.target.value)}
              placeholder="How you want it spelled in BitBudget"
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
          {formBusy ? "Saving…" : "Save rule"}
        </button>
      </form>
    </div>
  )
}

function ClusterCard({
  cluster,
  busy,
  onApply,
  onDismiss,
}: {
  cluster: PayeeNameCluster
  busy: boolean
  onApply: (canonical: string) => void
  onDismiss: () => void
}) {
  // Default to the highest-count variant as the initial canonical pick
  const [canonical, setCanonical] = useState(cluster.variants[0]?.displayName ?? "")

  return (
    <li className="relative flex flex-col rounded-xl border border-[#222] bg-[#0F0F0F]">
      {/* Dismiss button */}
      <button
        type="button"
        onClick={onDismiss}
        title="Skip — these are different businesses"
        aria-label="Dismiss this suggestion"
        className="absolute right-2.5 top-2.5 rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/5 hover:text-muted-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Tappable spelling chips — tap to pick the canonical */}
      <div className="flex flex-wrap gap-2 p-4 pb-3 pr-9">
        {cluster.variants.map((v) => {
          const isCanon = v.displayName === canonical
          return (
            <button
              key={v.normalized}
              type="button"
              onClick={() => setCanonical(v.displayName)}
              aria-pressed={isCanon}
              className={cn(
                "flex flex-col rounded-lg border px-3 py-2 text-left text-sm transition-all",
                isCanon
                  ? "border-btc-orange/50 bg-btc-orange/10 text-foreground"
                  : "border-[#2A2A2A] bg-[#181818] text-muted-foreground hover:border-[#3A3A3A] hover:text-foreground",
              )}
            >
              <span className="font-medium leading-none">{v.displayName}</span>
              <span className="mt-1.5 text-[11px] opacity-50">
                {v.count} {v.count === 1 ? "use" : "uses"}
              </span>
            </button>
          )
        })}
      </div>

      {/* Visual funnel: converges chips → arrow → destination */}
      <div className="flex flex-col items-center gap-0 px-4">
        {/* Dashed connector line */}
        <div className="h-5 w-px border-l border-dashed border-[#2A2A2A]" />

        {/* Save button — centered, bridging source chips and destination */}
        <button
          type="button"
          onClick={() => onApply(canonical)}
          disabled={busy}
          className="rounded-full border border-btc-orange/30 bg-btc-orange hover:bg-btc-orange/90 px-5 py-1.5 text-xs font-medium text-[#0D0D0D] transition-colors disabled:opacity-50"
        >
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </span>
          ) : (
            "Save"
          )}
        </button>

        {/* Arrow pointing to destination */}
        <ChevronDown className="h-4 w-4 text-[#333]" />
      </div>

      {/* Destination chip */}
      <div className="px-4 pb-4 pt-0">
        <div className="rounded-lg border border-[#2A2A2A] bg-[#181818] px-4 py-3 text-center">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground/80">merge into</p>
          <p className="mt-1 font-semibold text-foreground">{canonical}</p>
        </div>
      </div>
    </li>
  )
}
