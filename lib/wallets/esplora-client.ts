/**
 * Minimal typed client for Esplora-compatible APIs (mempool.space, Esplora,
 * Blockstream, self-hosted Umbrel). The whole client is **client-only** — it
 * never reaches BitBudget's backend. The base URL is supplied per call so
 * different wallets can target different explorers.
 *
 * **Privacy contract:**
 * - All requests go to the user-configured `baseUrl`. Nothing else is contacted.
 * - The xpub itself is never sent: only derived addresses appear in URLs.
 * - We never include `Referer` / `Origin`-leaking custom headers; the browser
 *   may still send those automatically based on its policy. Users who want
 *   maximum privacy should use a self-hosted node or Tor.
 */

export type AddressChain = 0 | 1

export interface EsploraStats {
  funded_txo_count: number
  funded_txo_sum: number
  spent_txo_count: number
  spent_txo_sum: number
  tx_count: number
}

export interface EsploraAddressInfo {
  address: string
  chain_stats: EsploraStats
  mempool_stats: EsploraStats
}

export interface EsploraTxStatus {
  confirmed: boolean
  block_height?: number
  block_hash?: string
  block_time?: number
}

export interface EsploraVin {
  txid: string
  vout: number
  prevout: {
    scriptpubkey_address?: string
    value: number
  } | null
}

export interface EsploraVout {
  scriptpubkey_address?: string
  value: number
}

export interface EsploraTx {
  txid: string
  version: number
  size: number
  weight: number
  fee: number
  vin: EsploraVin[]
  vout: EsploraVout[]
  status: EsploraTxStatus
}

export interface FetchLike {
  (input: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean
    status: number
    text: () => Promise<string>
    json: () => Promise<unknown>
  }>
}

export interface EsploraClientOptions {
  baseUrl: string
  /** Inject `fetch` for tests. Defaults to global fetch. */
  fetchImpl?: FetchLike
  /** Optional AbortSignal for cooperative cancellation of the whole client. */
  signal?: AbortSignal
  /** Throttle: minimum ms between requests. Default 150ms. */
  minRequestSpacingMs?: number
}

export class EsploraError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "EsploraError"
  }
}

const DEFAULT_SPACING = 150

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`
}

/**
 * Lightweight serial throttler. Esplora servers are sensitive to bursts; we
 * request at most one URL at a time per client instance with a small spacing.
 */
export class EsploraClient {
  readonly baseUrl: string
  private readonly fetchImpl: FetchLike
  private readonly signal: AbortSignal | undefined
  private readonly spacingMs: number
  private chain: Promise<void> = Promise.resolve()
  private lastAt = 0

  constructor(opts: EsploraClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    const fImpl = opts.fetchImpl ?? (typeof fetch !== "undefined" ? (fetch as unknown as FetchLike) : undefined)
    if (!fImpl) throw new Error("EsploraClient: no fetch implementation available")
    this.fetchImpl = fImpl
    this.signal = opts.signal
    this.spacingMs = opts.minRequestSpacingMs ?? DEFAULT_SPACING
  }

  private async runThrottled<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain
    let release: () => void = () => {}
    this.chain = new Promise<void>((resolve) => {
      release = resolve
    })
    await prev
    try {
      const wait = Math.max(0, this.lastAt + this.spacingMs - Date.now())
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      const out = await fn()
      this.lastAt = Date.now()
      return out
    } finally {
      release()
    }
  }

  private async req(path: string): Promise<Response | { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
    if (this.signal?.aborted) throw new Error("Aborted")
    const url = joinUrl(this.baseUrl, path)
    const res = await this.fetchImpl(url, this.signal ? { signal: this.signal } : undefined)
    if (!res.ok) {
      let body = ""
      try {
        body = await res.text()
      } catch {
        /* ignore */
      }
      throw new EsploraError(res.status, `Explorer returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
    }
    return res
  }

  async getTipHeight(): Promise<number> {
    return this.runThrottled(async () => {
      const res = await this.req("/api/blocks/tip/height")
      const body = (await res.text()).trim()
      const n = Number(body)
      if (!Number.isFinite(n)) throw new EsploraError(res.status, `Tip height was not numeric: ${body.slice(0, 80)}`)
      return n
    })
  }

  async getAddressInfo(address: string): Promise<EsploraAddressInfo> {
    return this.runThrottled(async () => {
      const res = await this.req(`/api/address/${address}`)
      return (await res.json()) as EsploraAddressInfo
    })
  }

  /**
   * Get the most recent confirmed + mempool transactions for an address. Esplora
   * paginates with 25 per page; subsequent pages use `/txs/chain/<last_seen_txid>`.
   * For typical personal wallets, the first page is enough; we paginate up to
   * `maxPages` to be safe.
   */
  async getAddressTxs(address: string, maxPages = 10): Promise<EsploraTx[]> {
    const all: EsploraTx[] = []
    let lastSeen: string | null = null
    for (let page = 0; page < maxPages; page++) {
      const path = lastSeen
        ? `/api/address/${address}/txs/chain/${lastSeen}`
        : `/api/address/${address}/txs`
      const batch = await this.runThrottled(async () => {
        const res = await this.req(path)
        return (await res.json()) as EsploraTx[]
      })
      if (!Array.isArray(batch) || batch.length === 0) break
      all.push(...batch)
      if (batch.length < 25) break
      lastSeen = batch[batch.length - 1]!.txid
    }
    return all
  }
}
