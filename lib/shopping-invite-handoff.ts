const STORAGE_KEY = "bitbudget-pending-shopping-invite"
const OWNER_KEY = "bitbudget-pending-shopping-invite-owner-pk"

export function capturePendingShoppingInvite(token: string, ownerPublicKey?: string | null): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
    if (ownerPublicKey) sessionStorage.setItem(OWNER_KEY, ownerPublicKey)
    else sessionStorage.removeItem(OWNER_KEY)
  } catch {
    /* ignore */
  }
}

export function loadPendingShoppingInvite(): { token: string; ownerPublicKey: string | null } | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const token = sessionStorage.getItem(STORAGE_KEY)
    if (!token) return null
    return { token, ownerPublicKey: sessionStorage.getItem(OWNER_KEY) }
  } catch {
    return null
  }
}

export function clearPendingShoppingInvite(): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(OWNER_KEY)
  } catch {
    /* ignore */
  }
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
