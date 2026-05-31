"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  buildPayeeDisplayRowsFromTransactions,
  findSimilarPayeeClusters,
  getPayeeRuleReviewClusters,
  normalizePayeeKey,
  type PayeeNameRule,
  type PayeeNameCluster,
} from "@/lib/payee-canonical"
import {
  addDismissedPayeeRules,
  loadDismissedPayeeRules,
  requestSettingsRulesTab,
} from "@/lib/payee-rule-dismissals"
import { Label } from "@/components/ui/label"
import { ChevronDown, ChevronUp, Link2, Loader2 } from "lucide-react"

type AliasRow = { id: string; sourceNormalized: string; canonicalPayee: string }

export function PayeeRulesReviewBanner() {
  const { activeTransactions, currentUserId, navigateTo } = useApp()
  const [aliases, setAliases] = useState<PayeeNameRule[]>([])
  const [aliasesLoading, setAliasesLoading] = useState(true)
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState(true)
  const [clusterBusyKey, setClusterBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAliases = useCallback(() => {
    setAliasesLoading(true)
    fetch("/api/payee-rules")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AliasRow[]) => {
        const list = Array.isArray(rows) ? rows : []
        setAliases(
          list.map((a) => ({
            sourceNormalized: a.sourceNormalized,
            canonicalPayee: a.canonicalPayee,
          })),
        )
      })
      .catch(() => setAliases([]))
      .finally(() => setAliasesLoading(false))
  }, [])

  useEffect(() => {
    loadAliases()
  }, [loadAliases])

  useEffect(() => {
    setIgnored(loadDismissedPayeeRules(currentUserId))
  }, [currentUserId])

  const payeeRows = useMemo(
    () => buildPayeeDisplayRowsFromTransactions(activeTransactions),
    [activeTransactions],
  )

  const allClusters = useMemo(() => findSimilarPayeeClusters(payeeRows), [payeeRows])

  const pendingClusters = useMemo(
    () => getPayeeRuleReviewClusters(allClusters, aliases, ignored),
    [allClusters, aliases, ignored],
  )

  function persistIgnore(keys: string[]) {
    if (!currentUserId || keys.length === 0) return
    addDismissedPayeeRules(currentUserId, keys)
    setIgnored(loadDismissedPayeeRules(currentUserId))
  }

  async function applyClusterMappings(cluster: PayeeNameCluster, canonicalDisplay: string) {
    const key = cluster.softKey
    setClusterBusyKey(key)
    setError(null)
    try {
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
          setError(typeof err.error === "string" ? err.error : "Could not save mapping")
          break
        }
      }
      loadAliases()
    } finally {
      setClusterBusyKey(null)
    }
  }

  if (!currentUserId || aliasesLoading) return null
  if (pendingClusters.length === 0) return null

  return (
    <div
      className="rounded-2xl border border-[#F7931A]/35 bg-[#0D0D0D] p-4 md:p-5"
      role="region"
      aria-label="Payee rule suggestions"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 rounded-lg bg-[#F7931A]/15 p-2 text-btc-orange">
            <Link2 className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Payee rules to review</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingClusters.length === 1
                ? "One group of similar spellings could use a single destination payee for imports."
                : `${pendingClusters.length} groups of similar spellings could use a single destination payee for imports.`}{" "}
              Map variants below, ignore a spelling you want to keep separate, or manage everything in Settings.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              requestSettingsRulesTab()
              navigateTo("settings")
            }}
            className="rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2 text-xs font-medium text-foreground hover:bg-[#252525]"
          >
            Payee rules in Settings
          </button>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="rounded-lg border border-[#333] p-2 text-muted-foreground hover:bg-[#1A1A1A] hover:text-foreground"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse suggestions" : "Expand suggestions"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {expanded && (
        <ul className="mt-4 flex flex-col gap-4">
          {pendingClusters.map((cluster) => (
            <ReviewClusterRow
              key={cluster.softKey}
              cluster={cluster}
              busy={clusterBusyKey === cluster.softKey}
              onApply={(canonical) => void applyClusterMappings(cluster, canonical)}
              onIgnoreVariant={(normalized) => persistIgnore([normalized])}
              onIgnoreGroup={() =>
                persistIgnore(cluster.variants.map((v) => v.normalized))
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ReviewClusterRow({
  cluster,
  busy,
  onApply,
  onIgnoreVariant,
  onIgnoreGroup,
}: {
  cluster: PayeeNameCluster
  busy: boolean
  onApply: (canonical: string) => void
  onIgnoreVariant: (normalized: string) => void
  onIgnoreGroup: () => void
}) {
  const [canonicalPick, setCanonicalPick] = useState(cluster.variants[0]?.displayName ?? "")

  return (
    <li className="rounded-xl border border-[#333] bg-[#1A1A1A] p-4">
      <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
        {cluster.variants.map((v) => (
          <li
            key={v.normalized}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-foreground"
          >
            <span>
              {v.displayName}{" "}
              <span className="text-muted-foreground">({v.count} tx)</span>
            </span>
            <button
              type="button"
              onClick={() => onIgnoreVariant(v.normalized)}
              className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Ignore this spelling
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">These should appear in BitBudget as:</Label>
            <select
              value={canonicalPick}
              onChange={(e) => setCanonicalPick(e.target.value)}
              className="rounded-md border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-foreground min-w-[180px]"
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
            className="rounded-lg bg-btc-orange px-3 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-btc-orange/90 disabled:opacity-50"
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </span>
            ) : (
              "Spell it like this"
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={onIgnoreGroup}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Ignore entire group
        </button>
      </div>
    </li>
  )
}
