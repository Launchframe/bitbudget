import type { UpdateSession } from "next-auth/react"
import { fetchNostrProfile } from "@/lib/nostr-local-signer"

const SYNC_STORAGE_PREFIX = "bitbudget-nostr-profile-sync:"
/** Backoff between background attempts within one sync run (ms). */
export const NOSTR_PROFILE_BACKGROUND_RETRY_DELAYS_MS = [0, 5_000, 15_000, 60_000, 300_000] as const
/** Failures across app loads before pausing relay lookups for a cooldown window. */
export const NOSTR_PROFILE_SYNC_MAX_FAILURES = 5
/** Pause background sync after repeated failures (ms). */
export const NOSTR_PROFILE_SYNC_COOLDOWN_MS = 60 * 60 * 1000

interface SyncProgress {
  failures: number
  lastFailureAt: number | null
  synced: boolean
}

function syncStorageKey(pubkey: string): string {
  return `${SYNC_STORAGE_PREFIX}${pubkey.slice(0, 16)}`
}

function readSyncProgress(pubkey: string): SyncProgress {
  try {
    if (typeof localStorage === "undefined") {
      return { failures: 0, lastFailureAt: null, synced: false }
    }
    const raw = localStorage.getItem(syncStorageKey(pubkey))
    if (!raw) return { failures: 0, lastFailureAt: null, synced: false }
    const parsed = JSON.parse(raw) as Partial<SyncProgress>
    return {
      failures: typeof parsed.failures === "number" ? parsed.failures : 0,
      lastFailureAt: typeof parsed.lastFailureAt === "number" ? parsed.lastFailureAt : null,
      synced: parsed.synced === true,
    }
  } catch {
    return { failures: 0, lastFailureAt: null, synced: false }
  }
}

function writeSyncProgress(pubkey: string, progress: SyncProgress): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(syncStorageKey(pubkey), JSON.stringify(progress))
  } catch {
    /* ignore quota / private mode */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function shouldAttemptNostrProfileSync(pubkey: string, now = Date.now()): boolean {
  const progress = readSyncProgress(pubkey)
  if (progress.synced) return false
  if (progress.failures < NOSTR_PROFILE_SYNC_MAX_FAILURES) return true
  if (!progress.lastFailureAt) return true
  return now - progress.lastFailureAt >= NOSTR_PROFILE_SYNC_COOLDOWN_MS
}

/** Reset failure counter after cooldown so the next app visit tries again. */
export function resetNostrProfileSyncCooldown(pubkey: string, now = Date.now()): void {
  const progress = readSyncProgress(pubkey)
  if (progress.synced) return
  if (progress.failures < NOSTR_PROFILE_SYNC_MAX_FAILURES) return
  if (!progress.lastFailureAt || now - progress.lastFailureAt < NOSTR_PROFILE_SYNC_COOLDOWN_MS) return
  writeSyncProgress(pubkey, { synced: false, failures: 0, lastFailureAt: null })
}

export async function postNostrProfileSync(body: {
  profileName: string
  profileImage: string
}): Promise<Response> {
  return fetch("/api/user/nostr-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * Retry relay fetch + persist until profile metadata lands or delays are exhausted.
 * Updates the Auth.js session when the server applies changes.
 */
export async function runNostrProfileBackgroundSync(
  pubkey: string,
  updateSession: UpdateSession,
  options: {
    relayTimeoutMs?: number
    retryDelaysMs?: readonly number[]
    fetchProfile?: typeof fetchNostrProfile
    postSync?: typeof postNostrProfileSync
    sleepFn?: (ms: number) => Promise<void>
  } = {},
): Promise<boolean> {
  const {
    relayTimeoutMs = 5_000,
    retryDelaysMs = NOSTR_PROFILE_BACKGROUND_RETRY_DELAYS_MS,
    fetchProfile = fetchNostrProfile,
    postSync = postNostrProfileSync,
    sleepFn = sleep,
  } = options

  resetNostrProfileSyncCooldown(pubkey)
  if (!shouldAttemptNostrProfileSync(pubkey)) return false

  const progress = readSyncProgress(pubkey)

  for (let i = 0; i < retryDelaysMs.length; i++) {
    const delay = retryDelaysMs[i] ?? 0
    if (delay > 0) await sleepFn(delay)

    const profile = await fetchProfile(pubkey, relayTimeoutMs)
    if (!profile.name && !profile.image) continue

    const res = await postSync({
      profileName: profile.name ?? "",
      profileImage: profile.image ?? "",
    })
    if (!res.ok) continue

    const data = (await res.json()) as {
      updated?: boolean
      needsSync?: boolean
      name?: string | null
      image?: string | null
    }

    if (data.updated) {
      writeSyncProgress(pubkey, { synced: true, failures: 0, lastFailureAt: null })
      await updateSession({
        name: data.name ?? undefined,
        image: data.image ?? undefined,
      })
      return true
    }

    if (data.needsSync === false) {
      writeSyncProgress(pubkey, { synced: true, failures: 0, lastFailureAt: null })
      return true
    }
  }

  writeSyncProgress(pubkey, {
    synced: false,
    failures: progress.failures + 1,
    lastFailureAt: Date.now(),
  })
  return false
}
