import { parseInviteFragmentParts } from "@/lib/shopping-invites"

const STORAGE_KEY = "bitbudget-pending-shopping-invite"
const OWNER_KEY = "bitbudget-pending-shopping-invite-owner-pk"
const JOIN_CODE_KEY = "bitbudget-pending-shopping-invite-join-code"

export function capturePendingShoppingInvite(
  token: string,
  ownerPublicKey?: string | null,
  joinCode?: string | null,
): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
    if (ownerPublicKey) sessionStorage.setItem(OWNER_KEY, ownerPublicKey)
    else sessionStorage.removeItem(OWNER_KEY)
    if (joinCode) sessionStorage.setItem(JOIN_CODE_KEY, joinCode)
    else sessionStorage.removeItem(JOIN_CODE_KEY)
  } catch {
    /* ignore */
  }
}

export function loadPendingShoppingInvite(): {
  token: string
  ownerPublicKey: string | null
  joinCode: string | null
} | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const token = sessionStorage.getItem(STORAGE_KEY)
    if (!token) return null
    return {
      token,
      ownerPublicKey: sessionStorage.getItem(OWNER_KEY),
      joinCode: sessionStorage.getItem(JOIN_CODE_KEY),
    }
  } catch {
    return null
  }
}

export function clearPendingShoppingInvite(): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(OWNER_KEY)
    sessionStorage.removeItem(JOIN_CODE_KEY)
  } catch {
    /* ignore */
  }
}

export function captureInviteFromLocation(
  hash: string,
  replaceHash?: () => void,
): { token: string; ownerPublicKey: string | null; joinCode: string | null } | null {
  const parsed = parseInviteFragmentParts(hash)
  if (!parsed) return null
  capturePendingShoppingInvite(parsed.token, parsed.ownerPublicKey, parsed.joinCode)
  replaceHash?.()
  return parsed
}
