/**
 * Shared validation for POST /api/transactions (client-created rows only).
 * Keeps source allowlisting aligned with skip-rule manual saves and rules-engine legs.
 */

/** Sources the authenticated client may set on POST /api/transactions (not ledger/cron paths). */
export const CLIENT_POST_SOURCES = new Set(["manual", "round_up", "surplus_sweep"])

export function normalizeTransactionSourceForCreate(raw: unknown): string | { error: string } {
  if (raw === undefined || raw === null) return "manual"
  if (typeof raw !== "string") return { error: "source must be a string" }
  const s = raw.trim()
  if (s.length === 0) return "manual"
  if (!/^[a-z0-9_]{1,64}$/.test(s)) return { error: "Invalid source" }
  if (!CLIENT_POST_SOURCES.has(s)) return { error: "Invalid source" }
  return s
}

/**
 * `round_up` / `surplus_sweep` are always hidden from main history.
 * `manual` may set `excludeFromMainHistory: true` when the user enables “skip main history”
 * (same payload shape as rules follow-up legs, but source stays `manual`).
 */
export function excludeFromMainHistoryForCreate(
  source: string,
  raw: unknown,
): boolean | { error: string } {
  if (source === "round_up" || source === "surplus_sweep") return true
  if (source !== "manual") return false
  if (raw === undefined || raw === null) return false
  if (typeof raw !== "boolean") return { error: "excludeFromMainHistory must be a boolean" }
  return raw
}
