/**
 * Per-custody-wallet budgeting settings: which envelope on-chain spends debit,
 * where receives land, which explorer to query, and the scan gap limit.
 *
 * Stored encrypted with the privacy key in `localStorage` under
 * `bitbudget-wallet-ledger-<userId>` (same wire format as the xpub store:
 * `<iv-hex>:<ciphertext-hex>` of `{ version, wallets: { [walletId]: … } }`).
 * Envelope ids and explorer URLs are budgeting metadata, not key material, but
 * they still describe the user's finances so they never sit in plaintext.
 *
 * These settings are device-local like the rest of custody state. A later
 * slice may sync them inside the encrypted watch bundle; the shape here is
 * versioned so that migration is additive.
 */

import { decryptField, encryptField } from "@/lib/crypto"
import { DEFAULT_EXPLORER_URL, DEFAULT_GAP_LIMIT, DEFAULT_RECEIVE_MODE, type WalletReceiveMode } from "@/lib/wallets/xpub-store"
import { normalizeExplorerBaseUrl } from "@/lib/wallets/esplora-client"
import type { BitcoinNetwork } from "@/lib/wallet/types"

export const LEDGER_SETTINGS_VERSION = 1
export const LEDGER_SETTINGS_KEY_PREFIX = "bitbudget-wallet-ledger-"

export interface CustodyLedgerSettings {
  /** Envelope debited by spends (and credited by receives when `receiveMode === "envelope"`). */
  defaultEnvelopeId: string | null
  receiveMode: WalletReceiveMode
  /** Esplora-compatible base URL, no trailing slash. */
  explorerBaseUrl: string
  gapLimit: number
  /** ISO timestamp of the last successful sync on this device. */
  lastSyncAt: string | null
}

interface LedgerSettingsBlob {
  version: number
  wallets: Record<string, CustodyLedgerSettings>
}

/**
 * Default explorer per network. mempool.space serves signet/testnet4 under a
 * path prefix; regtest has no public explorer so the user must supply one.
 */
export function defaultExplorerForNetwork(network: BitcoinNetwork): string {
  switch (network) {
    case "mainnet":
      return DEFAULT_EXPLORER_URL
    case "signet":
      return `${DEFAULT_EXPLORER_URL}/signet`
    case "testnet":
      return `${DEFAULT_EXPLORER_URL}/testnet`
    case "testnet4":
      return `${DEFAULT_EXPLORER_URL}/testnet4`
    case "regtest":
      return "http://127.0.0.1:3002"
    default: {
      const exhaustive: never = network
      return exhaustive
    }
  }
}

export function defaultLedgerSettings(network: BitcoinNetwork): CustodyLedgerSettings {
  return {
    defaultEnvelopeId: null,
    receiveMode: DEFAULT_RECEIVE_MODE,
    explorerBaseUrl: defaultExplorerForNetwork(network),
    gapLimit: DEFAULT_GAP_LIMIT,
    lastSyncAt: null,
  }
}

function storageKey(userId: string): string {
  return `${LEDGER_SETTINGS_KEY_PREFIX}${userId}`
}

function readRaw(userId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

function writeRaw(userId: string, value: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey(userId), value)
  } catch {
    throw new Error("Failed to save wallet settings (storage may be full or blocked).")
  }
}

function isReceiveMode(value: unknown): value is WalletReceiveMode {
  return value === "savings" || value === "envelope"
}

/** Coerce an untrusted record into a valid settings object, falling back per field. */
export function normalizeLedgerSettings(value: unknown, network: BitcoinNetwork): CustodyLedgerSettings {
  const base = defaultLedgerSettings(network)
  if (!value || typeof value !== "object") return base
  const v = value as Record<string, unknown>
  const gap = typeof v.gapLimit === "number" && Number.isInteger(v.gapLimit) && v.gapLimit >= 1 && v.gapLimit <= 200
    ? v.gapLimit
    : base.gapLimit
  return {
    defaultEnvelopeId: typeof v.defaultEnvelopeId === "string" && v.defaultEnvelopeId ? v.defaultEnvelopeId : null,
    receiveMode: isReceiveMode(v.receiveMode) ? v.receiveMode : base.receiveMode,
    explorerBaseUrl: typeof v.explorerBaseUrl === "string" && v.explorerBaseUrl
      ? normalizeExplorerBaseUrl(v.explorerBaseUrl)
      : base.explorerBaseUrl,
    gapLimit: gap,
    lastSyncAt: typeof v.lastSyncAt === "string" && Number.isFinite(Date.parse(v.lastSyncAt)) ? v.lastSyncAt : null,
  }
}

async function loadBlob(userId: string, privacyKey: Uint8Array): Promise<LedgerSettingsBlob> {
  const raw = readRaw(userId)
  if (!raw) return { version: LEDGER_SETTINGS_VERSION, wallets: {} }
  const json = await decryptField(raw, privacyKey)
  if (json === raw) throw new Error("Wallet settings are not in encrypted format")
  const parsed = JSON.parse(json) as unknown
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { wallets?: unknown }).wallets !== "object") {
    throw new Error("Wallet settings blob is malformed")
  }
  const obj = parsed as { version?: unknown; wallets: Record<string, unknown> }
  const wallets: Record<string, CustodyLedgerSettings> = {}
  for (const [id, entry] of Object.entries(obj.wallets ?? {})) {
    if (typeof id !== "string" || !id) continue
    // Network is unknown at blob level; normalize lazily on read per wallet.
    wallets[id] = entry as CustodyLedgerSettings
  }
  return { version: typeof obj.version === "number" ? obj.version : 0, wallets }
}

/** Settings for one custody wallet, or network defaults when none are saved yet. */
export async function loadLedgerSettings(
  userId: string,
  privacyKey: Uint8Array,
  walletId: string,
  network: BitcoinNetwork,
): Promise<CustodyLedgerSettings> {
  const blob = await loadBlob(userId, privacyKey)
  return normalizeLedgerSettings(blob.wallets[walletId], network)
}

/** Read → merge → encrypt → write. Always rewrites the whole blob. */
export async function saveLedgerSettings(
  userId: string,
  privacyKey: Uint8Array,
  walletId: string,
  network: BitcoinNetwork,
  patch: Partial<CustodyLedgerSettings>,
): Promise<CustodyLedgerSettings> {
  const blob = await loadBlob(userId, privacyKey)
  const current = normalizeLedgerSettings(blob.wallets[walletId], network)
  const next = normalizeLedgerSettings({ ...current, ...patch }, network)
  blob.wallets[walletId] = next
  const json = JSON.stringify({ version: LEDGER_SETTINGS_VERSION, wallets: blob.wallets } satisfies LedgerSettingsBlob)
  writeRaw(userId, await encryptField(json, privacyKey))
  return next
}

/** Remove one wallet's settings (e.g. after the custody record is deleted on this device). */
export async function clearLedgerSettings(userId: string, privacyKey: Uint8Array, walletId: string): Promise<void> {
  const blob = await loadBlob(userId, privacyKey)
  if (!(walletId in blob.wallets)) return
  delete blob.wallets[walletId]
  const json = JSON.stringify({ version: LEDGER_SETTINGS_VERSION, wallets: blob.wallets } satisfies LedgerSettingsBlob)
  writeRaw(userId, await encryptField(json, privacyKey))
}
