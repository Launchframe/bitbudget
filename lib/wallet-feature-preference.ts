export interface WalletFeatureGate {
  userId: string | null
  bitcoinEnabled: boolean
  accountReady: boolean
  privacyReady: boolean
  requested: boolean
  remembered: boolean
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">
const PREFERENCE_EVENT = "bitbudget:wallet-feature-preference"

export function walletFeaturePreferenceKey(userId: string): string {
  return `bitbudget-wallet-feature-v1:${userId}`
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function readPreference(userId: string | null, storage: PreferenceStorage | null): boolean | null {
  if (!userId || !storage) return null
  try {
    const raw = storage.getItem(walletFeaturePreferenceKey(userId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return typeof value === "object" && value !== null &&
      "version" in value && value.version === 1 &&
      "enabled" in value && typeof value.enabled === "boolean" ? value.enabled : null
  } catch {
    return null
  }
}

export function getWalletFeaturePreference(
  userId: string | null,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  return readPreference(userId, storage) === true
}

export function initializeWalletFeaturePreference(
  userId: string | null,
  storage: PreferenceStorage | null = browserStorage(),
): void {
  if (readPreference(userId, storage) === null) setWalletFeaturePreference(userId, true, storage)
}

export function setWalletFeaturePreference(
  userId: string | null,
  enabled: boolean,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  if (!userId || !storage) return false
  try {
    storage.setItem(walletFeaturePreferenceKey(userId), JSON.stringify({ version: 1, enabled }))
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFERENCE_EVENT))
    return true
  } catch {
    return false
  }
}

export function subscribeWalletFeaturePreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined
  window.addEventListener("storage", listener)
  window.addEventListener(PREFERENCE_EVENT, listener)
  return () => {
    window.removeEventListener("storage", listener)
    window.removeEventListener(PREFERENCE_EVENT, listener)
  }
}

export function shouldLoadWalletFeature(gate: WalletFeatureGate): boolean {
  return Boolean(gate.userId && gate.bitcoinEnabled && gate.accountReady && gate.privacyReady &&
    (gate.requested || gate.remembered))
}
