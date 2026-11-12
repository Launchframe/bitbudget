"use client"

import { parseConnectionUrl } from "@/lib/wallet/chain/connection-url"

export const ELECTRUM_READ_METHODS = Object.freeze([
  "server.version", "server.features", "server.ping", "blockchain.headers.subscribe",
  "blockchain.block.header", "blockchain.block.headers", "blockchain.scripthash.subscribe",
  "blockchain.scripthash.unsubscribe", "blockchain.scripthash.get_balance",
  "blockchain.scripthash.get_history", "blockchain.scripthash.listunspent",
  "blockchain.transaction.get", "blockchain.transaction.get_merkle", "blockchain.estimatefee",
  "mempool.get_fee_histogram",
] as const)

export type ElectrumReadMethod = typeof ELECTRUM_READ_METHODS[number]
export type ElectrumNotificationMethod = "blockchain.headers.subscribe" | "blockchain.scripthash.subscribe"
export type ElectrumSocket = Pick<WebSocket, "readyState" | "send" | "close" | "addEventListener" | "removeEventListener">
export type ElectrumErrorCode = "unsupported-transport" | "browser-only" | "disconnected" | "disposed" | "timeout" | "aborted" | "protocol" | "limit" | "remote-error" | "method-not-allowed" | "broadcast-disabled"

export class ElectrumError extends Error {
  constructor(readonly code: ElectrumErrorCode) {
    super(`Indexer request failed (${code}).`)
    this.name = "ElectrumError"
  }
}

export interface ElectrumClientOptions {
  url: string
  webSocketFactory?: (url: string) => ElectrumSocket
  timeoutMs?: number
  maxMessageBytes?: number
  maxPendingRequests?: number
  enableRegtestBroadcast?: boolean
  allowLoopbackDevelopment?: boolean
}

export interface ElectrumProbe {
  verification: "needs-consensus-verification"
  consensusProof: "not-implemented"
  observedServerVersion: string | null
  observedProtocolVersion: string | null
  observedGenesisHash: string | null
  observedNetwork: string | null
  observedHeaderHex: string | null
  observedHeaderBytes: number | null
  observedHeight: number | null
  headerObservation: "well-formed-unverified" | "missing-or-malformed"
}

type Pending = { resolve: (value: unknown) => void; reject: (error: ElectrumError) => void; cleanup: () => void }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown): string | null => typeof value === "string" && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
const natural = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const hex = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-fA-F]{2})+$/.test(value)

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new ElectrumError("limit")
  return result
}

export class ElectrumClient {
  readonly connection: ReturnType<typeof parseConnectionUrl>
  private readonly factory: (url: string) => ElectrumSocket
  private readonly timeoutMs: number
  private readonly maxBytes: number
  private readonly maxPending: number
  private readonly regtestBroadcast: boolean
  private socket: ElectrumSocket | null = null
  private connecting: Promise<void> | null = null
  private rejectConnection: ((error: ElectrumError) => void) | null = null
  private detach: (() => void) | null = null
  private disposed = false
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Map<ElectrumNotificationMethod, Set<(params: readonly unknown[]) => void>>()

  constructor(options: ElectrumClientOptions) {
    const developmentOrigin = options.allowLoopbackDevelopment && typeof window !== "undefined" ? window.location.origin : undefined
    this.connection = parseConnectionUrl(options.url, { developmentOrigin })
    if (this.connection.transport !== "wss" && this.connection.transport !== "ws") throw new ElectrumError("unsupported-transport")
    this.factory = options.webSocketFactory ?? ((url) => {
      if (typeof window === "undefined" || typeof WebSocket === "undefined") throw new ElectrumError("browser-only")
      return new WebSocket(url)
    })
    this.timeoutMs = bounded(options.timeoutMs, 10_000, 120_000)
    this.maxBytes = bounded(options.maxMessageBytes, 1_048_576, 4_194_304)
    this.maxPending = bounded(options.maxPendingRequests, 64, 256)
    this.regtestBroadcast = options.enableRegtestBroadcast === true
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new ElectrumError("disposed"))
    if (this.connecting) return this.connecting
    if (this.socket?.readyState === 1) return Promise.resolve()
    let socket: ElectrumSocket
    try {
      socket = this.factory(this.connection.url)
    } catch (error) {
      return Promise.reject(error instanceof ElectrumError ? error : new ElectrumError("disconnected"))
    }
    this.socket = socket
    const promise = new Promise<void>((resolve, reject) => {
      this.rejectConnection = reject
      const timer = setTimeout(() => this.disconnect(new ElectrumError("timeout")), this.timeoutMs)
      const open = () => {
        clearTimeout(timer)
        this.rejectConnection = null
        resolve()
      }
      const message = (event: MessageEvent) => this.receive(event.data)
      const closed = () => this.disconnect(new ElectrumError("disconnected"))
      socket.addEventListener("open", open)
      socket.addEventListener("message", message)
      socket.addEventListener("error", closed)
      socket.addEventListener("close", closed)
      this.detach = () => {
        clearTimeout(timer)
        socket.removeEventListener("open", open)
        socket.removeEventListener("message", message)
        socket.removeEventListener("error", closed)
        socket.removeEventListener("close", closed)
      }
      if (socket.readyState === 1) open()
    })
    this.connecting = promise
    const clear = () => { if (this.connecting === promise) this.connecting = null }
    void promise.then(clear, clear)
    return promise
  }

  private disconnect(error: ElectrumError): void {
    this.detach?.()
    this.detach = null
    const socket = this.socket
    this.socket = null
    this.connecting = null
    this.rejectConnection?.(error)
    this.rejectConnection = null
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
    try { socket?.close() } catch { return }
  }

  dispose(): void {
    this.disposed = true
    this.disconnect(new ElectrumError("disposed"))
    this.listeners.clear()
  }

  onNotification(method: ElectrumNotificationMethod, listener: (params: readonly unknown[]) => void): () => void {
    if (method !== "blockchain.headers.subscribe" && method !== "blockchain.scripthash.subscribe") throw new ElectrumError("method-not-allowed")
    if (this.disposed) throw new ElectrumError("disposed")
    const listeners = this.listeners.get(method) ?? new Set()
    if (listeners.size >= 64) throw new ElectrumError("limit")
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => { listeners.delete(listener) }
  }

  private receive(data: unknown): void {
    if (typeof data !== "string" || data.length > this.maxBytes || new TextEncoder().encode(data).length > this.maxBytes) {
      this.disconnect(new ElectrumError("limit"))
      return
    }
    let message: unknown
    try { message = JSON.parse(data) } catch {
      this.disconnect(new ElectrumError("protocol"))
      return
    }
    if (!record(message) || message.jsonrpc !== "2.0") {
      this.disconnect(new ElectrumError("protocol"))
      return
    }
    if (!("id" in message) && typeof message.method === "string" && Array.isArray(message.params)) {
      if (message.method === "blockchain.headers.subscribe" || message.method === "blockchain.scripthash.subscribe") {
        for (const listener of this.listeners.get(message.method) ?? []) {
          try { listener(message.params) } catch { continue }
        }
      }
      return
    }
    if (!natural(message.id) || ("result" in message) === ("error" in message) || "method" in message || ("error" in message && (!record(message.error) || !Number.isInteger(message.error.code)))) {
      this.disconnect(new ElectrumError("protocol"))
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    pending.cleanup()
    if ("error" in message) pending.reject(new ElectrumError("remote-error"))
    else pending.resolve(message.result)
  }

  request(method: ElectrumReadMethod, params: readonly unknown[] = [], signal?: AbortSignal): Promise<unknown> {
    if (!(ELECTRUM_READ_METHODS as readonly string[]).includes(method)) return Promise.reject(new ElectrumError("method-not-allowed"))
    return this.sendRequest(method, params, signal)
  }

  private sendRequest(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) return Promise.reject(new ElectrumError("disposed"))
    if (signal?.aborted) return Promise.reject(new ElectrumError("aborted"))
    if (this.pending.size >= this.maxPending || this.nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(new ElectrumError("limit"))
    const id = this.nextId++
    let body: string
    try {
      if (!Array.isArray(params)) throw new Error()
      body = JSON.stringify({ jsonrpc: "2.0", id, method, params })
      if (new TextEncoder().encode(body).length > this.maxBytes) throw new Error()
    } catch { return Promise.reject(new ElectrumError("limit")) }
    return new Promise((resolve, reject) => {
      const fail = (error: ElectrumError) => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.cleanup()
        reject(error)
      }
      const abort = () => fail(new ElectrumError("aborted"))
      const timer = setTimeout(() => fail(new ElectrumError("timeout")), this.timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
      }
      this.pending.set(id, { resolve, reject, cleanup })
      signal?.addEventListener("abort", abort, { once: true })
      void this.connect().then(() => {
        if (!this.pending.has(id)) return
        try {
          if (!this.socket || this.socket.readyState !== 1) throw new Error()
          this.socket.send(body)
        } catch { this.disconnect(new ElectrumError("disconnected")) }
      }, error => fail(error instanceof ElectrumError ? error : new ElectrumError("disconnected")))
    })
  }

  async broadcastTransaction(rawHex: string, intent: { userInitiated: true; network: "regtest" }, signal?: AbortSignal): Promise<string> {
    if (!this.regtestBroadcast || intent?.userInitiated !== true || intent.network !== "regtest") throw new ElectrumError("broadcast-disabled")
    if (!hex(rawHex) || rawHex.length > 800_000) throw new ElectrumError("limit")
    const result = await this.sendRequest("blockchain.transaction.broadcast", [rawHex], signal)
    if (typeof result !== "string" || !/^[0-9a-fA-F]{64}$/.test(result)) throw new ElectrumError("protocol")
    return result
  }

  async probeCapabilities(signal?: AbortSignal): Promise<ElectrumProbe> {
    const [version, features, header] = await Promise.all([
      this.request("server.version", ["BitBudget", "1.4"], signal),
      this.request("server.features", [], signal),
      this.request("blockchain.headers.subscribe", [], signal),
    ])
    const observedHeaderHex = record(header) && hex(header.hex) && header.hex.length <= 8192 ? header.hex.toLowerCase() : null
    const observedHeight = record(header) && natural(header.height) ? header.height : null
    return {
      verification: "needs-consensus-verification",
      consensusProof: "not-implemented",
      observedServerVersion: Array.isArray(version) ? text(version[0]) : text(version),
      observedProtocolVersion: Array.isArray(version) ? text(version[1]) : null,
      observedGenesisHash: record(features) && typeof features.genesis_hash === "string" && /^[0-9a-fA-F]{64}$/.test(features.genesis_hash) ? features.genesis_hash.toLowerCase() : null,
      observedNetwork: record(features) ? text(features.network) : null,
      observedHeaderHex,
      observedHeaderBytes: observedHeaderHex === null ? null : observedHeaderHex.length / 2,
      observedHeight,
      headerObservation: observedHeaderHex !== null && observedHeaderHex.length >= 160 && observedHeight !== null ? "well-formed-unverified" : "missing-or-malformed",
    }
  }
}
