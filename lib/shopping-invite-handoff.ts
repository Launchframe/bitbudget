/**
 * Pending shopping invite handoff across auth / Secure Your Data / unlock.
 * Prefer localStorage so logging out to fix a sign-in method does not drop the invite.
 * sessionStorage is written as a same-tab mirror for older tabs mid-flow.
 * The handoff lifetime is fixed at capture time (about 7 days). Reading it does not extend that.
 */

import { parseInviteFragmentParts } from "@/lib/shopping-invites"

const STORAGE_KEY = "bitbudget-pending-shopping-invite"
const OWNER_KEY = "bitbudget-pending-shopping-invite-owner-pk"
const JOIN_CODE_KEY = "bitbudget-pending-shopping-invite-join-code"
const EXPIRES_KEY = "bitbudget-pending-shopping-invite-expires"
/** Align roughly with typical invite link lifetime (7 days). */
const HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface PendingShoppingInvite {
  token: string
  ownerPublicKey: string | null
  joinCode: string | null
}

function storageBuckets(): Storage[] {
  const out: Storage[] = []
  if (typeof localStorage !== "undefined") out.push(localStorage)
  if (typeof sessionStorage !== "undefined") out.push(sessionStorage)
  return out
}

function writeAll(
  token: string,
  ownerPublicKey: string | null,
  joinCode: string | null,
  expiresAt: number,
): void {
  for (const store of storageBuckets()) {
    try {
      store.setItem(STORAGE_KEY, token)
      store.setItem(EXPIRES_KEY, String(expiresAt))
      if (ownerPublicKey) store.setItem(OWNER_KEY, ownerPublicKey)
      else store.removeItem(OWNER_KEY)
      if (joinCode) store.setItem(JOIN_CODE_KEY, joinCode)
      else store.removeItem(JOIN_CODE_KEY)
    } catch {
      /* ignore quota / private mode */
    }
  }
}

function clearStore(store: Storage): void {
  try {
    store.removeItem(STORAGE_KEY)
    store.removeItem(OWNER_KEY)
    store.removeItem(JOIN_CODE_KEY)
    store.removeItem(EXPIRES_KEY)
  } catch {
    /* ignore */
  }
}

function readFrom(store: Storage): PendingShoppingInvite | null {
  try {
    const token = store.getItem(STORAGE_KEY)
    if (!token) return null
    const expiresRaw = store.getItem(EXPIRES_KEY)
    if (expiresRaw != null && expiresRaw !== "") {
      const expiresAt = Number(expiresRaw)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        clearStore(store)
        return null
      }
    }
    return {
      token,
      ownerPublicKey: store.getItem(OWNER_KEY),
      joinCode: store.getItem(JOIN_CODE_KEY),
    }
  } catch {
    return null
  }
}

export function capturePendingShoppingInvite(
  token: string,
  ownerPublicKey?: string | null,
  joinCode?: string | null,
): void {
  if (typeof localStorage === "undefined" && typeof sessionStorage === "undefined") return
  writeAll(token, ownerPublicKey ?? null, joinCode ?? null, Date.now() + HANDOFF_TTL_MS)
}

function storedExpiry(store: Storage): number | null {
  try {
    const raw = store.getItem(EXPIRES_KEY)
    if (raw == null || raw === "") return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Mirror into the other bucket without sliding the original expiry. */
function mirrorInvite(invite: PendingShoppingInvite, expiresAt: number | null): void {
  writeAll(
    invite.token,
    invite.ownerPublicKey,
    invite.joinCode,
    expiresAt ?? Date.now() + HANDOFF_TTL_MS,
  )
}

export function loadPendingShoppingInvite(): PendingShoppingInvite | null {
  if (typeof localStorage !== "undefined") {
    const fromLocal = readFrom(localStorage)
    if (fromLocal) {
      mirrorInvite(fromLocal, storedExpiry(localStorage))
      return fromLocal
    }
  }
  if (typeof sessionStorage !== "undefined") {
    const fromSession = readFrom(sessionStorage)
    if (fromSession) {
      mirrorInvite(fromSession, storedExpiry(sessionStorage))
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
): PendingShoppingInvite | null {
  const parsed = parseInviteFragmentParts(hash)
  if (!parsed) return null
  capturePendingShoppingInvite(parsed.token, parsed.ownerPublicKey, parsed.joinCode)
  replaceHash?.()
  return parsed
}
