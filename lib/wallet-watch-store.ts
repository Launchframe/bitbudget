/**
 * Browser-only list of watched wallets and the confirmed sats on each.
 * Descriptors (address or xpub) stay in localStorage. Do not log them.
 */

import type { WatchRole } from "@/lib/wallet-confirmed-sats"

export const WALLET_WATCH_STORAGE_KEY = "bitbudget-wallet-watch"

/** Per-user key so a shared browser does not mix two accounts' addresses. */
export function walletWatchStorageKey(userId: string): string {
  return `${WALLET_WATCH_STORAGE_KEY}:${userId}`
}

export type WatchKind = "address" | "xpub"

export interface WalletWatch {
  id: string
  label: string
  role: WatchRole
  kind: WatchKind
  descriptor: string
  confirmedSats: number
  updatedAt: string | null
}

const ROLES = new Set<WatchRole>(["wallet", "exchange", "address"])
const KINDS = new Set<WatchKind>(["address", "xpub"])

type Listener = () => void

const listeners = new Set<Listener>()
const EMPTY_WATCHES: readonly WalletWatch[] = []
let cachedKey: string | null = null
let cachedRaw: string | null | undefined
let cachedWatches: readonly WalletWatch[] = EMPTY_WATCHES

export function subscribeWalletWatch(listener: Listener): () => void {
  const wasEmpty = listeners.size === 0
  listeners.add(listener)
  if (wasEmpty && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage)
    }
  }
}

export function getWalletWatchSnapshot(userId: string | null): readonly WalletWatch[] {
  if (!userId || typeof window === "undefined") return EMPTY_WATCHES
  const key = walletWatchStorageKey(userId)
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return cachedKey === key ? cachedWatches : EMPTY_WATCHES
  }
  if (key === cachedKey && raw === cachedRaw) return cachedWatches
  cachedKey = key
  cachedRaw = raw
  cachedWatches = parseWalletWatches(raw)
  return cachedWatches
}

export function getWalletWatchServerSnapshot(): readonly WalletWatch[] {
  return EMPTY_WATCHES
}

export function parseWalletWatches(raw: string | null): WalletWatch[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== "object") return []
  const watches = (parsed as { watches?: unknown }).watches
  if (!Array.isArray(watches)) return []
  const out: WalletWatch[] = []
  for (const row of watches) {
    const watch = parseWatch(row)
    if (watch) out.push(watch)
  }
  return out
}

export function serializeWalletWatches(watches: readonly WalletWatch[]): string {
  return JSON.stringify({ version: 1, watches })
}

export function writeWalletWatches(userId: string | null, watches: readonly WalletWatch[]): void {
  if (!userId) return
  const safe = watches
    .map((watch) => parseWatch(watch))
    .filter((watch): watch is WalletWatch => watch != null)
  const raw = serializeWalletWatches(safe)
  const key = walletWatchStorageKey(userId)
  cachedKey = key
  cachedRaw = raw
  cachedWatches = safe
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, raw)
    }
  } catch {
    /* private mode or a full disk — keep the in-memory snapshot */
  }
  emit()
}

/**
 * Update one watch from the latest stored list. A refresh that finishes after
 * the user removed the address must not write the address back.
 */
export function patchWalletWatch(
  userId: string | null,
  id: string,
  patch: Pick<WalletWatch, "confirmedSats" | "updatedAt">,
): void {
  if (!userId) return
  // A bad refresh must not delete the watch. writeWalletWatches drops any row
  // parseWatch rejects, including a fractional or negative balance.
  if (!Number.isInteger(patch.confirmedSats) || patch.confirmedSats < 0) return
  if (patch.updatedAt != null && typeof patch.updatedAt !== "string") return
  const current = getWalletWatchSnapshot(userId)
  if (!current.some((watch) => watch.id === id)) return
  writeWalletWatches(
    userId,
    current.map((watch) => (watch.id === id ? { ...watch, ...patch } : watch)),
  )
}

/** Logout: drop every account's watch list from this browser. */
export function clearAllWalletWatches(): void {
  cachedKey = null
  cachedRaw = undefined
  cachedWatches = EMPTY_WATCHES
  try {
    if (typeof window !== "undefined") {
      const keys: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (
          key === WALLET_WATCH_STORAGE_KEY ||
          key?.startsWith(`${WALLET_WATCH_STORAGE_KEY}:`)
        ) {
          keys.push(key)
        }
      }
      for (const key of keys) window.localStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
  emit()
}

function onStorage(event: StorageEvent) {
  if (
    event.key !== WALLET_WATCH_STORAGE_KEY &&
    !event.key?.startsWith(`${WALLET_WATCH_STORAGE_KEY}:`)
  ) {
    return
  }
  cachedKey = null
  cachedRaw = undefined
  emit()
}

function emit() {
  for (const listener of listeners) listener()
}

function parseWatch(row: unknown): WalletWatch | null {
  if (!row || typeof row !== "object") return null
  const value = row as Partial<WalletWatch>
  if (typeof value.id !== "string" || !value.id.trim()) return null
  if (typeof value.label !== "string") return null
  if (typeof value.role !== "string" || !ROLES.has(value.role as WatchRole)) return null
  if (typeof value.kind !== "string" || !KINDS.has(value.kind as WatchKind)) return null
  if (typeof value.descriptor !== "string" || !isSafeDescriptor(value.descriptor)) return null
  if (!Number.isInteger(value.confirmedSats) || (value.confirmedSats ?? 0) < 0) return null
  const updatedAt =
    value.updatedAt == null
      ? null
      : typeof value.updatedAt === "string"
        ? value.updatedAt
        : null
  if (value.updatedAt != null && updatedAt == null) return null
  return {
    id: value.id.trim(),
    label: value.label.trim().slice(0, 80) || "Wallet",
    role: value.role as WatchRole,
    kind: value.kind as WatchKind,
    descriptor: value.descriptor.trim(),
    confirmedSats: value.confirmedSats as number,
    updatedAt,
  }
}

/**
 * Reject seeds and private keys. Addresses and public descriptors only.
 * Extended private keys are matched at a token boundary so `wpkh(xprv…)` is
 * rejected and a bech32 address that merely contains those letters is kept.
 */
function isSafeDescriptor(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 200) return false
  if (/\s/.test(trimmed)) return false
  const lower = trimmed.toLowerCase()
  if (/(?:^|[^a-z0-9])(xprv|yprv|zprv|tprv|uprv|vprv)/.test(lower)) return false
  // WIF: mainnet 5 / K / L, testnet 9 (uncompressed) and c (compressed).
  if (/^[5kl9]/.test(lower) && trimmed.length >= 51 && trimmed.length <= 52) return false
  if (lower.startsWith("c") && trimmed.length === 52) return false
  // Mini private key (S + 21/25/29 base58 chars) and BIP38 encrypted key (6P, 58 chars).
  if (lower.startsWith("s") && (trimmed.length === 22 || trimmed.length === 26 || trimmed.length === 30)) {
    return false
  }
  if (lower.startsWith("6p") && trimmed.length === 58) return false
  if (/^(0x)?[0-9a-f]{64}$/.test(lower)) return false
  return true
}
