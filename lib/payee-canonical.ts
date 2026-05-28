/**
 * Payee resolution for imports/scans: **user-controlled** canonical names.
 *
 * - **Saved aliases** (Settings or “Save payee mapping”): map any import string → your canonical payee.
 * - **Soft-equal only** (automatic): same letters ignoring spaces/hyphens/apostrophes (Wal-Mart ↔ Walmart).
 *   Does **not** merge “Walmart” vs “Walmart Pharmacy” (different collapsed keys).
 *
 * We intentionally do **not** auto-merge by prefix (e.g. “Last War…” → “Last War”): that would
 * incorrectly collapse distinct payees like “Walmart” vs “Walmart Pharmacy”. Use aliases for those.
 */

export function normalizePayeeKey(payee: string): string {
  return payee
    .trim()
    .toLowerCase()
    .replace(/\s+#\s*\d+$/, "")
    .replace(/\s+/g, " ")
}

/** Collapse spaces and common punctuation for “same merchant, different spelling” (Wal-Mart vs Walmart). */
export function collapsePayeeSoftKey(payee: string): string {
  const n = normalizePayeeKey(payee)
  return n.replace(/[\s\-.'\u2019]+/g, "")
}

const MIN_CANDIDATE_LEN = 3

export interface PayeeCandidate {
  /** Display payee as stored on transactions or shortcuts */
  displayName: string
  /** How often this payee appears (txns + shortcut weight) */
  count: number
}

/** Only automatic reasons today; prefix matching removed for user control. */
export type CanonicalMatchReason = "alias" | "soft-equal"

export interface PayeeAliasRule {
  /** Database row id — present when loaded from the API, absent in test fixtures. */
  id?: string
  sourceNormalized: string
  canonicalPayee: string
}

export interface CanonicalPayeeResult {
  canonicalPayee: string
  /** Raw extracted string before canonicalization */
  originalExtracted: string
  reason: CanonicalMatchReason
  /** The specific alias rule that fired (alias reason only). */
  matchedAlias?: PayeeAliasRule
}

export interface PayeeNameVariant {
  displayName: string
  count: number
  normalized: string
}

/** Variants that look like the same merchant spelling (shared collapsed key) but use different stored names. */
export interface PayeeNameCluster {
  softKey: string
  variants: PayeeNameVariant[]
}

/**
 * Longest `sourceNormalized` wins so "wm super" beats "wm" when both prefix-match.
 *
 * Two passes:
 *  1. Exact normalized-key match (e.g. "wal-mart" alias matches "Wal-Mart" input).
 *  2. Soft-equal fallback: collapsed form matches (e.g. "walmart" input matches "wal-mart" alias).
 *     This ensures an existing "Wal-Mart → Walmart" alias also fires when the receipt says "Walmart".
 */
export function matchLongestAlias(
  extracted: string,
  aliases: PayeeAliasRule[],
): PayeeAliasRule | null {
  const e = normalizePayeeKey(extracted)
  if (!e || aliases.length === 0) return null

  // Pass 1: exact normalized key match
  let best: PayeeAliasRule | null = null
  let bestLen = -1

  for (const a of aliases) {
    const s = a.sourceNormalized
    if (s.length < 2) continue
    if (e === s || e.startsWith(`${s} `)) {
      if (s.length > bestLen) {
        bestLen = s.length
        best = a
      }
    }
  }
  if (best) return best

  // Pass 2: soft-equal fallback (strips spaces, hyphens, apostrophes)
  const ec = collapsePayeeSoftKey(e)
  let softBest: PayeeAliasRule | null = null
  let softBestLen = -1

  for (const a of aliases) {
    const s = a.sourceNormalized
    if (s.length < 2) continue
    if (collapsePayeeSoftKey(s) === ec && s.length > softBestLen) {
      softBestLen = s.length
      softBest = a
    }
  }
  return softBest
}

/**
 * Resolve extracted payee: **aliases first**, then **soft-equal** (punctuation/spacing only).
 */
export function resolveCanonicalPayee(
  extracted: string,
  candidates: PayeeCandidate[],
  aliases: PayeeAliasRule[] = [],
): CanonicalPayeeResult | null {
  const ext = normalizePayeeKey(extracted)
  if (ext.length === 0) return null

  const aliasHit = matchLongestAlias(extracted, aliases)
  if (aliasHit) {
    const extRaw = extracted.trim()
    const canon = aliasHit.canonicalPayee.trim()
    if (canon === extRaw) return null
    return {
      canonicalPayee: canon,
      originalExtracted: extRaw,
      reason: "alias",
      matchedAlias: aliasHit,
    }
  }

  const ec = collapsePayeeSoftKey(extracted)
  const extRawForSoft = extracted.trim()

  let softEqualBest: { displayName: string; count: number } | null = null
  for (const { displayName, count } of candidates) {
    const nc = normalizePayeeKey(displayName)
    if (nc.length < MIN_CANDIDATE_LEN) continue
    if (displayName.trim() === extRawForSoft) continue
    if (ec !== collapsePayeeSoftKey(displayName)) continue
    if (
      !softEqualBest ||
      count > softEqualBest.count ||
      (count === softEqualBest.count && displayName.length < softEqualBest.displayName.length)
    ) {
      softEqualBest = { displayName, count }
    }
  }
  if (softEqualBest) {
    return {
      canonicalPayee: softEqualBest.displayName,
      originalExtracted: extracted.trim(),
      reason: "soft-equal",
    }
  }

  return null
}

/**
 * Groups stored payees that differ only by spacing/punctuation (same `collapsePayeeSoftKey`).
 * Does **not** group “Walmart” with “Walmart Pharmacy” (different collapsed keys).
 * Use this in Settings to surface names that may need explicit aliases to a single canonical.
 */
export function findSimilarPayeeClusters(
  rows: { displayName: string; count: number }[],
): PayeeNameCluster[] {
  const merged = mergePayeeCandidates(rows)
  const bySoft = new Map<string, PayeeNameCluster>()

  for (const { displayName, count } of merged) {
    const soft = collapsePayeeSoftKey(displayName)
    if (soft.length < MIN_CANDIDATE_LEN) continue
    const normalized = normalizePayeeKey(displayName)
    let g = bySoft.get(soft)
    if (!g) {
      g = { softKey: soft, variants: [] }
      bySoft.set(soft, g)
    }
    g.variants.push({ displayName, count, normalized })
  }

  const out: PayeeNameCluster[] = []
  for (const g of bySoft.values()) {
    const uniqueNorms = new Set(g.variants.map((v) => v.normalized))
    if (uniqueNorms.size >= 2) {
      g.variants.sort((a, b) => b.count - a.count)
      out.push(g)
    }
  }

  out.sort((a, b) => {
    const ta = a.variants.reduce((s, v) => s + v.count, 0)
    const tb = b.variants.reduce((s, v) => s + v.count, 0)
    return tb - ta
  })
  return out
}

/**
 * Build payee frequency rows from decrypted transaction payees (same logic as Settings → Payee mappings).
 */
export function buildPayeeDisplayRowsFromTransactions(
  transactions: readonly { payee: string }[],
): PayeeCandidate[] {
  const counts = new Map<string, number>()
  const displayByKey = new Map<string, string>()
  for (const t of transactions) {
    const k = t.payee.toLowerCase()
    if (!displayByKey.has(k)) displayByKey.set(k, t.payee)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const rows: PayeeCandidate[] = []
  for (const [k, count] of counts) {
    const displayName = displayByKey.get(k)
    if (displayName) rows.push({ displayName, count })
  }
  return mergePayeeCandidates(rows)
}

/**
 * True when some variant can serve as canonical and every other variant has a saved alias mapping to it.
 */
export function isClusterResolvedByAliases(
  cluster: PayeeNameCluster,
  aliases: PayeeAliasRule[],
): boolean {
  const variants = cluster.variants
  if (variants.length < 2) return true

  for (const candidate of variants) {
    const kNorm = candidate.normalized
    let allOk = true
    for (const v of variants) {
      if (v.normalized === kNorm) continue
      const mapped = aliases.some(
        (a) =>
          a.sourceNormalized === v.normalized &&
          normalizePayeeKey(a.canonicalPayee) === kNorm,
      )
      if (!mapped) {
        allOk = false
        break
      }
    }
    if (allOk) return true
  }
  return false
}

/** Drop ignored spellings; returns null if fewer than two distinct names remain. */
export function filterClusterIgnoredVariants(
  cluster: PayeeNameCluster,
  ignoredNormalized: ReadonlySet<string>,
): PayeeNameCluster | null {
  const variants = cluster.variants.filter((v) => !ignoredNormalized.has(v.normalized))
  const uniqueNorms = new Set(variants.map((v) => v.normalized))
  if (uniqueNorms.size < 2) return null
  const sorted = [...variants].sort((a, b) => b.count - a.count)
  return { softKey: cluster.softKey, variants: sorted }
}

/** Clusters that still need user action (not fully aliased, after per-name ignores). */
export function getPayeeMappingReviewClusters(
  clusters: PayeeNameCluster[],
  aliases: PayeeAliasRule[],
  ignoredNormalized: ReadonlySet<string>,
): PayeeNameCluster[] {
  const out: PayeeNameCluster[] = []
  for (const c of clusters) {
    const filtered = filterClusterIgnoredVariants(c, ignoredNormalized)
    if (!filtered) continue
    if (isClusterResolvedByAliases(filtered, aliases)) continue
    out.push(filtered)
  }
  return out
}

/** Prefer higher-count spelling, then shorter label, then lexicographic (stable canonical display). */
function compareRepresentativeCandidates(
  a: { displayName: string; count: number },
  b: { displayName: string; count: number },
): number {
  if (a.count !== b.count) return b.count - a.count
  if (a.displayName.length !== b.displayName.length) {
    return a.displayName.length - b.displayName.length
  }
  return a.displayName.localeCompare(b.displayName)
}

/** Merge duplicate display names by summing counts */
export function mergePayeeCandidates(rows: PayeeCandidate[]): PayeeCandidate[] {
  type Agg = {
    totalCount: number
    representative: { displayName: string; count: number }
  }
  const map = new Map<string, Agg>()
  const keyOrder: string[] = []

  for (const { displayName, count } of rows) {
    const key = normalizePayeeKey(displayName)
    if (!key) continue

    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        totalCount: count,
        representative: { displayName, count },
      })
      keyOrder.push(key)
      continue
    }

    existing.totalCount += count
    if (
      compareRepresentativeCandidates(
        { displayName, count },
        existing.representative,
      ) < 0
    ) {
      existing.representative = { displayName, count }
    }
  }

  return keyOrder.map((key) => {
    const entry = map.get(key)!
    return {
      displayName: entry.representative.displayName,
      count: entry.totalCount,
    }
  })
}
