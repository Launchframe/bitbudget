/**
 * Client-only dismissals for payee mapping suggestions (per normalized payee spelling).
 * Scoped by user id so another account on the same browser does not inherit ignores.
 */

const STORAGE_KEY = "bitbudget-payee-mapping-ignored-suggestions"

type StoredShape = { userId: string; ignored: string[] }

function parseStored(raw: string | null): StoredShape | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    const o = v as { userId?: unknown; ignored?: unknown }
    if (typeof o.userId !== "string" || !Array.isArray(o.ignored)) return null
    const ignored = o.ignored.filter((x): x is string => typeof x === "string")
    return { userId: o.userId, ignored }
  } catch {
    return null
  }
}

export function loadIgnoredPayeeMappingSuggestions(userId: string | null): Set<string> {
  if (!userId || typeof window === "undefined") return new Set()
  const parsed = parseStored(localStorage.getItem(STORAGE_KEY))
  if (!parsed || parsed.userId !== userId) return new Set()
  return new Set(parsed.ignored)
}

export function addIgnoredPayeeMappingSuggestions(userId: string, normalizedKeys: string[]): void {
  if (!userId || typeof window === "undefined" || normalizedKeys.length === 0) return
  const parsed = parseStored(localStorage.getItem(STORAGE_KEY))
  const base =
    parsed && parsed.userId === userId ? new Set(parsed.ignored) : new Set<string>()
  for (const k of normalizedKeys) {
    if (k) base.add(k)
  }
  const next: StoredShape = { userId, ignored: [...base] }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota or private mode */
  }
}

/** Open Settings on the Payee mappings tab (read once on Settings mount). */
export const SETTINGS_INITIAL_TAB_STORAGE_KEY = "bitbudget-settings-initial-tab"

export function requestSettingsPayeeMappingsTab(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(SETTINGS_INITIAL_TAB_STORAGE_KEY, "payees")
  } catch {
    /* ignore */
  }
}

/** Open Settings on the Integrations tab (read once on Settings mount). */
export function requestSettingsIntegrationsTab(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(SETTINGS_INITIAL_TAB_STORAGE_KEY, "integrations")
  } catch {
    /* ignore */
  }
}
