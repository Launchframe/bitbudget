/**
 * Pending shopping invite handoff across auth / Secure Your Data / unlock.
 * Prefer localStorage so logging out to fix a sign-in method does not drop the invite.
 * sessionStorage is written as a same-tab mirror for older tabs mid-flow.
 */

const STORAGE_KEY = "bitbudget-pending-shopping-invite"
const OWNER_KEY = "bitbudget-pending-shopping-invite-owner-pk"
const EXPIRES_KEY = "bitbudget-pending-shopping-invite-expires"
/** Align roughly with typical invite link lifetime (7 days). */
const HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000

function storageBuckets(): Storage[] {
  const out: Storage[] = []
  if (typeof localStorage !== "undefined") out.push(localStorage)
  if (typeof sessionStorage !== "undefined") out.push(sessionStorage)
  return out
}

function writeAll(token: string, ownerPublicKey: string | null, expiresAt: number): void {
  for (const store of storageBuckets()) {
    try {
      store.setItem(STORAGE_KEY, token)
      store.setItem(EXPIRES_KEY, String(expiresAt))
      if (ownerPublicKey) store.setItem(OWNER_KEY, ownerPublicKey)
      else store.removeItem(OWNER_KEY)
    } catch {
      /* ignore quota / private mode */
    }
  }
}

function clearStore(store: Storage): void {
  try {
    store.removeItem(STORAGE_KEY)
    store.removeItem(OWNER_KEY)
    store.removeItem(EXPIRES_KEY)
  } catch {
    /* ignore */
  }
}

function readFrom(store: Storage): { token: string; ownerPublicKey: string | null } | null {
  try {
    const token = store.getItem(STORAGE_KEY)
    if (!token) return null
    const expiresRaw = store.getItem(EXPIRES_KEY)
    if (expiresRaw) {
      const expiresAt = Number(expiresRaw)
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        clearStore(store)
        return null
      }
    }
    return { token, ownerPublicKey: store.getItem(OWNER_KEY) }
  } catch {
    return null
  }
}

export function capturePendingShoppingInvite(token: string, ownerPublicKey?: string | null): void {
  if (typeof localStorage === "undefined" && typeof sessionStorage === "undefined") return
  writeAll(token, ownerPublicKey ?? null, Date.now() + HANDOFF_TTL_MS)
}

export function loadPendingShoppingInvite(): { token: string; ownerPublicKey: string | null } | null {
  if (typeof localStorage !== "undefined") {
    const fromLocal = readFrom(localStorage)
    if (fromLocal) {
      // Refresh TTL + mirror into sessionStorage for mid-flow tabs.
      writeAll(fromLocal.token, fromLocal.ownerPublicKey, Date.now() + HANDOFF_TTL_MS)
      return fromLocal
    }
  }
  if (typeof sessionStorage !== "undefined") {
    const fromSession = readFrom(sessionStorage)
    if (fromSession) {
      writeAll(fromSession.token, fromSession.ownerPublicKey, Date.now() + HANDOFF_TTL_MS)
      return fromSession
    }
  }
  return null
}

/**
 * Clear after a successful join claim (or explicit dismiss).
 * Do **not** call this on logout — users often sign out to switch Google ↔ email mid-invite.
 */
export function clearPendingShoppingInvite(): void {
  for (const store of storageBuckets()) clearStore(store)
}

export function captureInviteFromLocation(
  hash: string,
  replaceHash?: () => void,
): { token: string; ownerPublicKey: string | null } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw) return null
  const [tokenPart, ownerPart] = raw.split(".")
  let token = tokenPart ?? ""
  try {
    token = decodeURIComponent(token)
  } catch {
    return null
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null
  const ownerPublicKey = ownerPart && /^[0-9a-f]{64}$/.test(ownerPart) ? ownerPart : null
  capturePendingShoppingInvite(token, ownerPublicKey)
  replaceHash?.()
  return { token, ownerPublicKey }
}
