"use client"

import { parseConnectionUrl } from "@/lib/wallet/chain/connection-url"

export type EsploraErrorCode = "browser-only" | "unsupported-transport" | "invalid-input" | "network" | "http" | "redirect" | "invalid-response" | "limit" | "timeout" | "aborted" | "disposed"

export class EsploraError extends Error {
  constructor(readonly code: EsploraErrorCode, readonly status?: number) {
    super(`Explorer request failed (${code}).`)
    this.name = "EsploraError"
  }
}

export interface EsploraStatus {
  confirmed: boolean
  block_height?: number
  block_hash?: string
  block_time?: number
}

export interface EsploraUtxo {
  txid: string
  vout: number
  value: number
  status: EsploraStatus
}

export interface EsploraTransaction {
  txid: string
  fee: number
  status: EsploraStatus
}

export interface EsploraStats {
  funded_txo_count: number
  funded_txo_sum: number
  spent_txo_count: number
  spent_txo_sum: number
  tx_count: number
}

export interface EsploraCollection<T> {
  items: T[]
  complete: boolean
  completeness: "server-reported" | "page-limit" | "mempool-limit" | "inconsistent-pagination"
  consensusVerified: false
  snapshotConsistent: false
}

export interface EsploraClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const natural = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)
const invalid = (): never => { throw new EsploraError("invalid-response") }

function parseStatus(value: unknown): EsploraStatus {
  if (!object(value) || typeof value.confirmed !== "boolean") return invalid()
  if (!value.confirmed) {
    if (value.block_height !== undefined || value.block_hash !== undefined || value.block_time !== undefined) return invalid()
    return { confirmed: false }
  }
  if (!natural(value.block_height) || !hash(value.block_hash) || !natural(value.block_time)) return invalid()
  return { confirmed: true, block_height: value.block_height, block_hash: value.block_hash.toLowerCase(), block_time: value.block_time }
}

function parseTx(value: unknown): EsploraTransaction {
  if (!object(value) || !hash(value.txid) || !natural(value.fee)) return invalid()
  return { txid: value.txid.toLowerCase(), fee: value.fee, status: parseStatus(value.status) }
}

function parseStats(value: unknown): EsploraStats {
  if (!object(value)) return invalid()
  const keys = ["funded_txo_count", "funded_txo_sum", "spent_txo_count", "spent_txo_sum", "tx_count"] as const
  const result = {} as EsploraStats
  for (const key of keys) {
    if (!natural(value[key])) return invalid()
    result[key] = value[key]
  }
  return result
}

function addressPath(address: string): string {
  if (typeof address !== "string" || !/^[a-zA-Z0-9]{14,120}$/.test(address)) throw new EsploraError("invalid-input")
  return `address/${address}`
}

function txPath(txid: string): string {
  if (!hash(txid)) throw new EsploraError("invalid-input")
  return `tx/${txid.toLowerCase()}`
}

function collection<T>(items: T[], completeness: EsploraCollection<T>["completeness"]): EsploraCollection<T> {
  return { items, complete: completeness === "server-reported", completeness, consensusVerified: false, snapshotConsistent: false }
}

export class EsploraClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxBytes: number
  private controllers = new Set<AbortController>()
  private disposed = false

  constructor(options: EsploraClientOptions) {
    const connection = parseConnectionUrl(options.baseUrl)
    if (connection.transport !== "https") throw new EsploraError("unsupported-transport")
    this.baseUrl = connection.url.endsWith("/api") ? connection.url : `${connection.url}/api`
    this.fetchImpl = options.fetchImpl ?? ((input, init) => {
      if (typeof window === "undefined") return Promise.reject(new EsploraError("browser-only"))
      return fetch(input, init)
    })
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.maxBytes = options.maxResponseBytes ?? 2_097_152
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 8_388_608) throw new EsploraError("limit")
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  private async request(path: string, signal?: AbortSignal, json = true): Promise<unknown> {
    if (this.disposed) throw new EsploraError("disposed")
    if (signal?.aborted) throw new EsploraError("aborted")
    if (this.controllers.size >= 16) throw new EsploraError("limit")
    const controller = new AbortController()
    this.controllers.add(controller)
    let timedOut = false
    const abort = () => controller.abort()
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    let onAbort: () => void = () => {}
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new EsploraError(this.disposed ? "disposed" : timedOut ? "timeout" : "aborted"))
      controller.signal.addEventListener("abort", onAbort, { once: true })
    })
    const url = `${this.baseUrl}/${path}`
    const perform = async () => {
      const response = await this.fetchImpl(url, {
        method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
        redirect: "error", cache: "no-store", signal: controller.signal,
      })
      if (controller.signal.aborted) throw new EsploraError("aborted")
      if (response.redirected || (response.url && response.url !== url)) throw new EsploraError("redirect")
      if (!response.ok) throw new EsploraError("http", response.status)
      const length = response.headers.get("content-length")
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.maxBytes)) throw new EsploraError("limit")
      if (!response.body) return invalid()
      const reader = response.body.getReader()
      const cancelReader = () => { void reader.cancel().catch(() => {}) }
      controller.signal.addEventListener("abort", cancelReader, { once: true })
      const decoder = new TextDecoder("utf-8", { fatal: true })
      let total = 0
      let body = ""
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > this.maxBytes) throw new EsploraError("limit")
          body += decoder.decode(value, { stream: true })
        }
        body += decoder.decode()
        if (!json) return body
        try { return JSON.parse(body) as unknown } catch { return invalid() }
      } finally {
        controller.signal.removeEventListener("abort", cancelReader)
        cancelReader()
      }
    }
    try {
      return await Promise.race([perform(), cancelled])
    } catch (error) {
      if (error instanceof EsploraError) throw error
      throw new EsploraError("network")
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      controller.signal.removeEventListener("abort", onAbort)
      controller.abort()
      this.controllers.delete(controller)
    }
  }

  async getTipHeight(signal?: AbortSignal): Promise<number> {
    const value = await this.request("blocks/tip/height", signal, false)
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\s*$/.test(value) || !natural(Number(value))) return invalid()
    return Number(value)
  }

  async getAddressInfo(address: string, signal?: AbortSignal): Promise<{ address: string; chain_stats: EsploraStats; mempool_stats: EsploraStats }> {
    const value = await this.request(addressPath(address), signal)
    if (!object(value) || value.address !== address) return invalid()
    return { address, chain_stats: parseStats(value.chain_stats), mempool_stats: parseStats(value.mempool_stats) }
  }

  async getAddressUtxos(address: string, signal?: AbortSignal): Promise<EsploraCollection<EsploraUtxo>> {
    const value = await this.request(`${addressPath(address)}/utxo`, signal)
    if (!Array.isArray(value) || value.length > 50_000) return invalid()
    const seen = new Set<string>()
    const items = value.map(item => {
      if (!object(item) || !hash(item.txid) || !natural(item.vout) || item.vout > 0xffffffff || !natural(item.value)) return invalid()
      const txid = item.txid.toLowerCase()
      const key = `${txid}:${item.vout}`
      if (seen.has(key)) return invalid()
      seen.add(key)
      return { txid, vout: item.vout, value: item.value, status: parseStatus(item.status) }
    })
    return collection(items, "server-reported")
  }

  async getTransactionStatus(txid: string, signal?: AbortSignal): Promise<EsploraStatus> {
    return parseStatus(await this.request(`${txPath(txid)}/status`, signal))
  }

  async getTransaction(txid: string, signal?: AbortSignal): Promise<EsploraTransaction> {
    const item = parseTx(await this.request(txPath(txid), signal))
    if (item.txid !== txid.toLowerCase()) return invalid()
    return item
  }

  async getTransactionHex(txid: string, signal?: AbortSignal): Promise<string> {
    const value = await this.request(`${txPath(txid)}/hex`, signal, false)
    if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) return invalid()
    return value.toLowerCase()
  }

  async getFeeEstimates(signal?: AbortSignal): Promise<Record<string, number>> {
    const value = await this.request("fee-estimates", signal)
    if (!object(value) || Object.keys(value).length > 1000) return invalid()
    const result: Record<string, number> = {}
    for (const [key, fee] of Object.entries(value)) {
      if (!/^[1-9][0-9]{0,5}$/.test(key) || typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) return invalid()
      result[key] = fee
    }
    return result
  }

  async getAddressTxs(address: string, options: { maxPages?: number; signal?: AbortSignal } = {}): Promise<EsploraCollection<EsploraTransaction>> {
    const path = addressPath(address)
    const maxPages = options.maxPages ?? 100
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new EsploraError("invalid-input")
    const mempool = await this.request(`${path}/txs/mempool`, options.signal)
    if (!Array.isArray(mempool) || mempool.length > 50) return invalid()
    const items = mempool.map(parseTx)
    if (items.some(item => item.status.confirmed)) return invalid()
    const seen = new Set(items.map(item => item.txid))
    if (seen.size !== items.length) return invalid()
    let cursor = ""
    for (let page = 0; page < maxPages; page++) {
      const value = await this.request(`${path}/txs/chain${cursor ? `/${cursor}` : ""}`, options.signal)
      if (!Array.isArray(value) || value.length > 25) return invalid()
      const transactions = value.map(parseTx)
      if (transactions.some(item => !item.status.confirmed)) return invalid()
      for (const item of transactions) {
        if (seen.has(item.txid)) return collection(items, "inconsistent-pagination")
        seen.add(item.txid)
        items.push(item)
      }
      if (transactions.length < 25) return collection(items, mempool.length === 50 ? "mempool-limit" : "server-reported")
      cursor = transactions[transactions.length - 1].txid
    }
    return collection(items, "page-limit")
  }
}
