/**
 * Payee resolution for imports/scans: **user-controlled** canonical names.
 *
 * - **Saved aliases** (Settings or “Save payee mapping”): map any import string → your canonical payee.
 * - **Soft-equal only** (automatic): same letters ignoring spaces/hyphens/apostrophes (Wal-Mart ↔ Walmart).
 *   Does **not** merge “Walmart” vs “Walmart Liquor” (different collapsed keys).
 *
 * We intentionally do **not** auto-merge by prefix (e.g. “Last War…” → “Last War”): that would
 * incorrectly collapse distinct payees like “Walmart” vs “Walmart Liquor”. Use aliases for those.
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
  sourceNormalized: string
  canonicalPayee: string
}

export interface CanonicalPayeeResult {
  canonicalPayee: string
  /** Raw extracted string before canonicalization */
  originalExtracted: string
  reason: CanonicalMatchReason
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
 */
export function matchLongestAlias(
  extracted: string,
  aliases: PayeeAliasRule[],
): PayeeAliasRule | null {
  const e = normalizePayeeKey(extracted)
  if (!e || aliases.length === 0) return null

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
  return best
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
    const canon = aliasHit.canonicalPayee.trim()
    if (normalizePayeeKey(canon) === ext) return null
    return {
      canonicalPayee: canon,
      originalExtracted: extracted.trim(),
      reason: "alias",
    }
  }

  const ec = collapsePayeeSoftKey(extracted)

  let softEqualBest: { displayName: string; count: number } | null = null
  for (const { displayName, count } of candidates) {
    const nc = normalizePayeeKey(displayName)
    if (nc.length < MIN_CANDIDATE_LEN) continue
    if (ext === nc) continue
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
 * Does **not** group “Walmart” with “Walmart Liquor” (different collapsed keys).
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

/** Merge duplicate display names by summing counts */
export function mergePayeeCandidates(rows: PayeeCandidate[]): PayeeCandidate[] {
  const map = new Map<string, number>()
  for (const { displayName, count } of rows) {
    const key = normalizePayeeKey(displayName)
    if (!key) continue
    const existing = map.get(key) ?? 0
    map.set(key, existing + count)
  }
  const out: PayeeCandidate[] = []
  const seen = new Set<string>()
  for (const { displayName, count } of rows) {
    const key = normalizePayeeKey(displayName)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ displayName, count: map.get(key) ?? count })
  }
  return out
}
