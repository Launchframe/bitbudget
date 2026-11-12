/**
 * Client-only Esplora address lookup. The address is requested from the
 * browser. No BitBudget route accepts it.
 */

export const DEFAULT_ESPLORA_BASE = "https://mempool.space/api"

const BASE58_ADDRESS = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
const BECH32_ADDRESS = /^bc1[02-9ac-hj-np-z]{11,87}$/i

/** Bech32 is case-insensitive. Base58 addresses keep their original case. */
export function canonicalBitcoinAddress(value: string): string {
  const trimmed = value.trim()
  return trimmed.toLowerCase().startsWith("bc1") ? trimmed.toLowerCase() : trimmed
}

export function addressWatchError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return "Enter an address."
  if (/\s/.test(trimmed)) {
    return "Paste one address. A seed is not accepted."
  }
  if (/^(xprv|yprv|zprv|xpub|ypub|zpub)/i.test(trimmed)) {
    return "Paste one address. A key is not accepted."
  }
  if (/^[5KL]/.test(trimmed) && trimmed.length >= 51 && trimmed.length <= 52) {
    return "Paste one address. A key is not accepted."
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return "Paste one address. A key is not accepted."
  }
  if (!BASE58_ADDRESS.test(trimmed) && !BECH32_ADDRESS.test(trimmed)) {
    return "That doesn't look like a bitcoin address."
  }
  return null
}

/** Confirmed sats from an Esplora `/address/:addr` body. Mempool outs are ignored. */
export function confirmedSatsFromEsploraBody(body: unknown): number | null {
  if (!body || typeof body !== "object") return null
  const chain = (body as { chain_stats?: unknown }).chain_stats
  if (!chain || typeof chain !== "object") return null
  const funded = (chain as { funded_txo_sum?: unknown }).funded_txo_sum
  const spent = (chain as { spent_txo_sum?: unknown }).spent_txo_sum
  if (typeof funded !== "number" || typeof spent !== "number") return null
  if (!Number.isFinite(funded) || !Number.isFinite(spent)) return null
  return Math.max(0, Math.round(funded - spent))
}

export async function fetchAddressConfirmedSats(
  address: string,
  init?: { fetchFn?: typeof fetch; baseUrl?: string },
): Promise<number> {
  const fetchFn = init?.fetchFn ?? fetch
  const base = (init?.baseUrl ?? DEFAULT_ESPLORA_BASE).replace(/\/$/, "")
  const lookup = canonicalBitcoinAddress(address)
  const response = await fetchFn(`${base}/address/${encodeURIComponent(lookup)}`, {
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new Error("Address lookup failed")
  }
  const body: unknown = await response.json()
  const sats = confirmedSatsFromEsploraBody(body)
  if (sats == null) throw new Error("Address lookup failed")
  return sats
}
