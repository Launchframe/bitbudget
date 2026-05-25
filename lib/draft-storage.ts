const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function loadDraft<T>(key: string, validate: (value: unknown) => value is T): T | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(key)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    return validate(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveDraft<T>(key: string, value: T, debounceMs = 400): void {
  if (typeof sessionStorage === "undefined") return
  const existing = debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key)
      try {
        sessionStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* quota / private mode */
      }
    }, debounceMs),
  )
}

export function saveDraftImmediate<T>(key: string, value: T): void {
  if (typeof sessionStorage === "undefined") return
  const existing = debounceTimers.get(key)
  if (existing) {
    clearTimeout(existing)
    debounceTimers.delete(key)
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function clearDraft(key: string): void {
  if (typeof sessionStorage === "undefined") return
  const existing = debounceTimers.get(key)
  if (existing) {
    clearTimeout(existing)
    debounceTimers.delete(key)
  }
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Remove all bitbudget draft keys (logout sweep). */
export function clearAllDrafts(): void {
  if (typeof sessionStorage === "undefined") return
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k?.startsWith("bitbudget-") && k.endsWith("-draft")) keys.push(k)
    }
    for (const k of keys) sessionStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
