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

/** One confirmed movement on an address. Positive nets were received. */
export interface AddressChainMovement {
  txid: string
  time: number | null
  netSats: number
}

/**
 * Confirmed activity for an address from an Esplora `/address/:addr/txs` body.
 * Unconfirmed rows are skipped. A row that does not move this address is skipped.
 * Bech32 matches either case. Base58 must match exactly. Newest confirmed rows
 * come first. This is history only: it is not income and not spending.
 */
export function chainMovementsFromEsploraTxs(
  address: string,
  body: unknown,
): AddressChainMovement[] {
  if (!Array.isArray(body)) return []
  const want = canonicalBitcoinAddress(address)
  const rows: AddressChainMovement[] = []
  for (const tx of body) {
    if (!tx || typeof tx !== "object") continue
    const record = tx as {
      txid?: unknown
      status?: { confirmed?: unknown; block_time?: unknown }
      vin?: unknown
      vout?: unknown
    }
    if (typeof record.txid !== "string" || !record.txid) continue
    if (record.status?.confirmed !== true) continue
    const blockTime = record.status.block_time
    const time = typeof blockTime === "number" && Number.isFinite(blockTime) ? blockTime : null
    let received = 0
    let spent = 0
    if (Array.isArray(record.vout)) {
      for (const out of record.vout) {
        if (outputAddress(out) === want) received += outputSats(out)
      }
    }
    if (Array.isArray(record.vin)) {
      for (const input of record.vin) {
        const prevout =
          input && typeof input === "object"
            ? (input as { prevout?: unknown }).prevout
            : null
        if (outputAddress(prevout) === want) spent += outputSats(prevout)
      }
    }
    const netSats = Math.round(received - spent)
    if (netSats === 0) continue
    rows.push({ txid: record.txid, time, netSats })
  }
  rows.sort((a, b) => (b.time ?? -1) - (a.time ?? -1))
  return rows
}

function outputAddress(out: unknown): string | null {
  if (!out || typeof out !== "object") return null
  const address = (out as { scriptpubkey_address?: unknown }).scriptpubkey_address
  return typeof address === "string" ? canonicalBitcoinAddress(address) : null
}

function outputSats(out: unknown): number {
  if (!out || typeof out !== "object") return 0
  const value = (out as { value?: unknown }).value
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0
  return value
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

/** Recent confirmed movements. The address is requested from the browser only. */
export async function fetchAddressChainMovements(
  address: string,
  init?: { fetchFn?: typeof fetch; baseUrl?: string },
): Promise<AddressChainMovement[]> {
  const fetchFn = init?.fetchFn ?? fetch
  const base = (init?.baseUrl ?? DEFAULT_ESPLORA_BASE).replace(/\/$/, "")
  const lookup = canonicalBitcoinAddress(address)
  const response = await fetchFn(`${base}/address/${encodeURIComponent(lookup)}/txs`, {
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new Error("Address activity lookup failed")
  }
  const body: unknown = await response.json()
  if (!Array.isArray(body)) {
    throw new Error("Address activity lookup failed")
  }
  return chainMovementsFromEsploraTxs(lookup, body)
}
