import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearPrivacyKeyCache,
  getValidCachedPrivacyKeyHex,
  hasPotentialPrivacyKeyCache,
  PRIVACY_KEY_CACHE_TTL_MS,
  setCachedPrivacyKeyHex,
} from "@/lib/privacy-key-storage"

const K_KEY = "bitbudget-privacy-key"
const K_USER = "bitbudget-privacy-user"
const K_EXPIRES = "bitbudget-privacy-unlock-expires"

function createMemoryStorage(): Storage {
  const store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  }
}

describe("privacy key storage policy", () => {
  const NOW = new Date("2026-01-01T12:00:00.000Z")

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const ls = createMemoryStorage()
    const ss = createMemoryStorage()
    vi.stubGlobal("localStorage", ls)
    vi.stubGlobal("sessionStorage", ss)
    vi.stubGlobal("window", { localStorage: ls, sessionStorage: ss } as Window & typeof globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("uses a 7-day TTL", () => {
    expect(PRIVACY_KEY_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("returns a cached key before the TTL expires", () => {
    setCachedPrivacyKeyHex("user-1", "abc123")

    expect(getValidCachedPrivacyKeyHex("user-1")).toBe("abc123")
    expect(hasPotentialPrivacyKeyCache()).toBe(true)
  })

  it("expires and clears a cached key once the TTL has elapsed", () => {
    setCachedPrivacyKeyHex("user-1", "abc123")

    vi.setSystemTime(new Date(NOW.getTime() + PRIVACY_KEY_CACHE_TTL_MS + 1))

    expect(getValidCachedPrivacyKeyHex("user-1")).toBeNull()
    expect(localStorage.getItem(K_KEY)).toBeNull()
    expect(localStorage.getItem(K_USER)).toBeNull()
    expect(localStorage.getItem(K_EXPIRES)).toBeNull()
    expect(hasPotentialPrivacyKeyCache()).toBe(false)
  })

  it("clears the cached key when the stored userId does not match", () => {
    setCachedPrivacyKeyHex("user-1", "abc123")

    expect(getValidCachedPrivacyKeyHex("user-2")).toBeNull()
    expect(localStorage.getItem(K_KEY)).toBeNull()
    expect(hasPotentialPrivacyKeyCache()).toBe(false)
  })

  it("migrates a legacy sessionStorage entry into localStorage", () => {
    sessionStorage.setItem(K_KEY, "legacy-hex")
    sessionStorage.setItem(K_USER, "user-1")

    expect(getValidCachedPrivacyKeyHex("user-1")).toBe("legacy-hex")
    expect(localStorage.getItem(K_KEY)).toBe("legacy-hex")
    expect(localStorage.getItem(K_USER)).toBe("user-1")
    expect(localStorage.getItem(K_EXPIRES)).not.toBeNull()
  })

  it("falls back to sessionStorage when localStorage is unavailable for writes", () => {
    const lsStore: Record<string, string> = {}
    const ls: Storage = {
      get length() {
        return Object.keys(lsStore).length
      },
      clear: () => {
        for (const k of Object.keys(lsStore)) delete lsStore[k]
      },
      getItem: (k: string) => (k in lsStore ? lsStore[k]! : null),
      setItem: () => {
        throw new Error("localStorage unavailable")
      },
      removeItem: (k: string) => {
        delete lsStore[k]
      },
      key: (i: number) => Object.keys(lsStore)[i] ?? null,
    }
    const ss = createMemoryStorage()
    vi.unstubAllGlobals()
    vi.stubGlobal("localStorage", ls)
    vi.stubGlobal("sessionStorage", ss)
    vi.stubGlobal("window", { localStorage: ls, sessionStorage: ss } as Window & typeof globalThis)

    setCachedPrivacyKeyHex("user-1", "sess-only")

    expect(sessionStorage.getItem(K_KEY)).toBe("sess-only")
    expect(sessionStorage.getItem(K_USER)).toBe("user-1")
    expect(getValidCachedPrivacyKeyHex("user-1")).toBe("sess-only")
  })

  it("hasPotentialPrivacyKeyCache is false when storages are empty", () => {
    expect(hasPotentialPrivacyKeyCache()).toBe(false)
  })

  it("clearPrivacyKeyCache removes entries from both storages", () => {
    localStorage.setItem(K_KEY, "a")
    localStorage.setItem(K_USER, "u")
    sessionStorage.setItem(K_KEY, "b")
    sessionStorage.setItem(K_USER, "u2")

    clearPrivacyKeyCache()

    expect(localStorage.getItem(K_KEY)).toBeNull()
    expect(sessionStorage.getItem(K_KEY)).toBeNull()
  })
})
