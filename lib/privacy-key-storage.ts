/**
 * Client-side cache for the raw privacy key hex after unlock (passphrase, NIP-04, etc.).
 * Uses localStorage with a TTL so users are not prompted every new browser session,
 * but must re-enter passphrase periodically (default 7 days).
 * Falls back to sessionStorage if localStorage is unavailable (quota / private mode).
 *
 * **Security:** any script on the origin can read `localStorage`. Storing the raw key
 * increases impact of XSS compared to session-only storage; mitigate with a strict CSP,
 * no unsafe-inline scripts, and careful dependency audit. Alternatives (device-bound CryptoKey
 * wrapping the cached material) add complexity and are not used here.
 */

/** How long the cached key remains valid after each successful unlock. */
export const PRIVACY_KEY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const K_KEY = "bitbudget-privacy-key"
const K_USER = "bitbudget-privacy-user"
const K_EXPIRES = "bitbudget-privacy-unlock-expires"

function storageSet(
  storage: Storage,
  userId: string,
  hexKey: string,
  expiresAtMs: number,
): void {
  storage.setItem(K_KEY, hexKey)
  storage.setItem(K_USER, userId)
  storage.setItem(K_EXPIRES, String(expiresAtMs))
}

function storageClear(storage: Storage): void {
  storage.removeItem(K_KEY)
  storage.removeItem(K_USER)
  storage.removeItem(K_EXPIRES)
}

/**
 * True when either storage has key+user rows (may still be expired or for another user).
 * Used to skip `getSession()` when no cache exists and the import resolver can go
 * straight to `GET /api/user/encryption`.
 */
export function hasPotentialPrivacyKeyCache(): boolean {
  if (typeof window === "undefined") return false
  const hasPair = (storage: Storage): boolean => {
    try {
      const hex = storage.getItem(K_KEY)
      const user = storage.getItem(K_USER)
      return Boolean(hex && user)
    } catch {
      return false
    }
  }
  return hasPair(localStorage) || hasPair(sessionStorage)
}

/**
 * Returns the cached key hex if it exists for this user and is not expired.
 * Migrates legacy sessionStorage-only entries to localStorage with a fresh TTL.
 */
export function getValidCachedPrivacyKeyHex(expectedUserId: string): string | null {
  if (typeof window === "undefined") return null

  const readLocal = (): { hex: string; user: string; exp: string | null } | null => {
    try {
      const hex = localStorage.getItem(K_KEY)
      const user = localStorage.getItem(K_USER)
      const exp = localStorage.getItem(K_EXPIRES)
      if (hex && user) return { hex, user, exp }
    } catch {
      /* ignore */
    }
    return null
  }

  const readSession = (): { hex: string; user: string } | null => {
    try {
      const hex = sessionStorage.getItem(K_KEY)
      const user = sessionStorage.getItem(K_USER)
      if (hex && user) return { hex, user }
    } catch {
      /* ignore */
    }
    return null
  }

  try {
    const local = readLocal()
    if (local && local.user === expectedUserId) {
      const expMs = local.exp != null ? parseInt(local.exp, 10) : NaN
      if (!local.exp || !Number.isFinite(expMs)) {
        setCachedPrivacyKeyHex(expectedUserId, local.hex)
        return local.hex
      }
      if (Date.now() < expMs) {
        return local.hex
      }
      clearPrivacyKeyCache()
    } else if (local && local.user !== expectedUserId) {
      clearPrivacyKeyCache()
    }

    const sess = readSession()
    if (sess && sess.user === expectedUserId) {
      setCachedPrivacyKeyHex(expectedUserId, sess.hex)
      try {
        storageClear(sessionStorage)
      } catch {
        /* ignore */
      }
      return sess.hex
    } else if (sess && sess.user !== expectedUserId) {
      try {
        storageClear(sessionStorage)
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null
  }

  return null
}

/** Persist key with a new TTL window (call after each successful unlock). */
export function setCachedPrivacyKeyHex(userId: string, hexKey: string): void {
  if (typeof window === "undefined") return
  const expiresAtMs = Date.now() + PRIVACY_KEY_CACHE_TTL_MS
  try {
    storageSet(localStorage, userId, hexKey, expiresAtMs)
    try {
      storageClear(sessionStorage)
    } catch {
      /* ignore */
    }
  } catch {
    try {
      storageSet(sessionStorage, userId, hexKey, expiresAtMs)
    } catch {
      /* private mode / blocked */
    }
  }
}

/** Clear cached key from both storages (logout, user switch, expiry cleanup). */
export function clearPrivacyKeyCache(): void {
  if (typeof window === "undefined") return
  try {
    storageClear(localStorage)
  } catch {
    /* ignore */
  }
  try {
    storageClear(sessionStorage)
  } catch {
    /* ignore */
  }
}
