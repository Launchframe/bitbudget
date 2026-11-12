/**
 * Browser-only list of watched wallets and the confirmed sats on each.
 * Descriptors (address or xpub) stay in localStorage. Do not log them.
 */

import type { WatchRole } from "@/lib/wallet-confirmed-sats"

export const WALLET_WATCH_STORAGE_KEY = "bitbudget-wallet-watch"

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

export function getWalletWatchSnapshot(): readonly WalletWatch[] {
  if (typeof window === "undefined") return EMPTY_WATCHES
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(WALLET_WATCH_STORAGE_KEY)
  } catch {
    return cachedWatches
  }
  if (raw === cachedRaw) return cachedWatches
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

export function writeWalletWatches(watches: readonly WalletWatch[]): void {
  const safe = watches
    .map((watch) => parseWatch(watch))
    .filter((watch): watch is WalletWatch => watch != null)
  const raw = serializeWalletWatches(safe)
  cachedRaw = raw
  cachedWatches = safe
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WALLET_WATCH_STORAGE_KEY, raw)
    }
  } catch {
    /* private mode or a full disk — keep the in-memory snapshot */
  }
  emit()
}

function onStorage(event: StorageEvent) {
  if (event.key !== WALLET_WATCH_STORAGE_KEY) return
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

/** Reject seeds and private keys. Addresses and public descriptors only. */
function isSafeDescriptor(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 200) return false
  if (/\s/.test(trimmed)) return false
  const lower = trimmed.toLowerCase()
  if (lower.startsWith("xprv") || lower.startsWith("yprv") || lower.startsWith("zprv")) return false
  return true
}
