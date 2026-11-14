/**
 * Monotonic fence so an in-flight passphrase decrypt cannot apply after a
 * successful encryption reset — including across tabs, which share localStorage.
 * The unlock form captures the fence when it mounts; apply checks the latest value.
 */

export const ENCRYPTION_UNLOCK_FENCE_KEY = "bitbudget-encryption-unlock-fence"

let memoryFence = 0

function readStoredFence(): number {
  if (typeof localStorage === "undefined") return 0
  try {
    const raw = localStorage.getItem(ENCRYPTION_UNLOCK_FENCE_KEY)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Latest fence, adopting a higher value written by another tab. */
export function currentUnlockFence(): number {
  const stored = readStoredFence()
  if (stored > memoryFence) memoryFence = stored
  return memoryFence
}

export function bumpUnlockFence(): number {
  const next = currentUnlockFence() + 1
  memoryFence = next
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ENCRYPTION_UNLOCK_FENCE_KEY, String(next))
    }
  } catch {
    /* private mode / quota */
  }
  return next
}

/** False when reset (this tab or another) advanced the fence after the form mounted. */
export function shouldApplyUnlock(fenceAtMount: number): boolean {
  return fenceAtMount === currentUnlockFence()
}

export function resetUnlockFenceForTests(): void {
  memoryFence = 0
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(ENCRYPTION_UNLOCK_FENCE_KEY)
    }
  } catch {
    /* ignore */
  }
}
