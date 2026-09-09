import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { checkServerIdentity, connect as connectTls, createSecureContext } from "node:tls"
import { connect as connectTcp, isIP } from "node:net"
import { WebSocketServer, WebSocket } from "ws"
import { SocksClient } from "socks"
import { REQUEST_BYTES, RESPONSE_BYTES, isObject, validateRequest } from "./protocol.mjs"
import { createPolicyGuard } from "./policy.mjs"

function copyPem(value, allowArray = false) {
  if (value === undefined || typeof value === "string") return value
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (allowArray && Array.isArray(value)) return Object.freeze(value.map(item => {
    if (typeof item !== "string" && !Buffer.isBuffer(item)) throw new Error("Invalid bridge configuration")
    return copyPem(item)
  }))
  throw new Error("Invalid bridge configuration")
}

function snapshotConfig(config) {
  if (!isObject(config)) throw new Error("Invalid bridge configuration")
  return Object.freeze({
    ...config,
    allowedOrigins: Array.isArray(config.allowedOrigins) ? Object.freeze([...config.allowedOrigins]) : config.allowedOrigins,
    allowedHosts: Array.isArray(config.allowedHosts) ? Object.freeze([...config.allowedHosts]) : config.allowedHosts,
    socksProxy: config.socksProxy == null ? config.socksProxy : Object.freeze({ host: config.socksProxy.host, port: config.socksProxy.port }),
    upstreamCa: copyPem(config.upstreamCa, true), tlsKey: copyPem(config.tlsKey), tlsCert: copyPem(config.tlsCert),
  })
}

export function validateConfig(config) {
  const { host, port, upstreamHost, upstreamPort, upstreamServername, allowedOrigins, mode } = config
  if (!["loopback-development", "tls"].includes(mode) || !["127.0.0.1", "::1", "0.0.0.0"].includes(host) || !Number.isInteger(port) || port < 0 || port > 65535 ||
    typeof upstreamHost !== "string" || (!isIP(upstreamHost) && !/^[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/.test(upstreamHost)) ||
    !Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535 || typeof upstreamServername !== "string" || (!isIP(upstreamServername) && !/^[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/.test(upstreamServername))) throw new Error("Invalid bridge configuration")
  if (mode === "loopback-development" && (process.env.NODE_ENV === "production" || !["127.0.0.1", "::1"].includes(host))) throw new Error("Plain WebSocket transport is limited to loopback development")
  if (mode === "tls" && (!config.tlsKey || !config.tlsCert)) throw new Error("Browser-facing TLS certificate and key are required")
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.length > 8) throw new Error("An explicit browser origin allowlist is required")
  for (const origin of allowedOrigins) {
    if (typeof origin !== "string") throw new Error("Invalid allowed browser origin")
    const parsed = new URL(origin)
    const local = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    if (parsed.origin !== origin || parsed.username || parsed.password || (mode === "loopback-development" ? !local : parsed.protocol !== "https:")) throw new Error("Invalid allowed browser origin")
  }
  if (upstreamHost.toLowerCase().endsWith(".onion") && (!/^[a-z2-7]{56}\.onion$/.test(upstreamHost) || !config.socksProxy)) throw new Error("Onion upstreams require a SOCKS proxy; direct resolution is forbidden")
  if (config.socksProxy && (!isIP(config.socksProxy.host) || !Number.isInteger(config.socksProxy.port) || config.socksProxy.port < 1 || config.socksProxy.port > 65535)) throw new Error("Invalid SOCKS proxy")
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 10 || config.timeoutMs > 60000)) throw new Error("Invalid bridge timeout")
  if (mode === "tls" && (!Array.isArray(config.allowedHosts) || !config.allowedHosts.length || config.allowedHosts.length > 8 || config.allowedHosts.some(host => typeof host !== "string" || !/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?$/.test(host)))) throw new Error("An explicit TLS Host allowlist is required")
  createSecureContext({ ca: config.upstreamCa, minVersion: "TLSv1.2" })
}

export function createElectrumBridge(input) {
  const config = snapshotConfig(input)
  const assertPolicy = createPolicyGuard(config)
  assertPolicy()
  validateConfig(config)
  const sessions = new Set()
  const origins = new Set(config.allowedOrigins)
  const handler = (request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("X-Content-Type-Options", "nosniff")
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ service: "bitbudget-electrum-bridge", readOnly: true, upstreamTlsRequired: true }))
    } else { response.writeHead(404); response.end() }
  }
  const server = config.mode === "tls" ? createHttpsServer({ key: config.tlsKey, cert: config.tlsCert, minVersion: "TLSv1.2" }, handler) : createHttpServer(handler)
  server.headersTimeout = 10000
  server.requestTimeout = 15000
  server.maxConnections = 32
  const wss = new WebSocketServer({ noServer: true, maxPayload: REQUEST_BYTES, perMessageDeflate: false, clientTracking: true })
  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {})
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : config.port
    const hosts = config.mode === "loopback-development" ? [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`] : config.allowedHosts
    if (request.url !== "/electrum" || !origins.has(request.headers.origin) || !Array.isArray(hosts) || !hosts.includes(request.headers.host) || sessions.size >= 8) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
      return
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws))
  })
  wss.on("connection", ws => {
    const pending = new Map()
    const subscriptions = new Set()
    let headersSubscribed = false
    let upstream = null
    let incoming = Buffer.alloc(0)
    let ready = false
    let closed = false
    let windowStarted = performance.now()
    let windowRequests = 0
    let lastRequestId = -1
    let connectTimer
    let alive = true
    const session = { close: () => close() }
    sessions.add(session)
    const close = (code = 1000, reason = "Bridge connection closed") => {
      if (closed) return
      closed = true
      clearTimeout(connectTimer)
      clearInterval(heartbeat)
      for (const entry of pending.values()) clearTimeout(entry.timer)
      pending.clear(); subscriptions.clear(); incoming = Buffer.alloc(0)
      upstream?.destroy()
      sessions.delete(session)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(code, reason)
        const timeout = setTimeout(() => ws.terminate(), 1000)
        timeout.unref()
      } else ws.terminate()
    }
    const send = value => {
      const body = JSON.stringify(value)
      if (ws.readyState !== WebSocket.OPEN || Buffer.byteLength(body) > RESPONSE_BYTES || ws.bufferedAmount > RESPONSE_BYTES) { close(1009, "Bridge capacity exceeded"); return }
      ws.send(body, error => { if (error) close(1011) })
    }
    const fail = (id, code) => send({ jsonrpc: "2.0", id, error: { code, message: code === -32601 ? "Read-only bridge: method not allowed" : "Bridge request rejected" } })
    const forward = entry => {
      if (!ready || closed) return
      if (upstream.writableLength > REQUEST_BYTES * 8) { close(1009, "Bridge capacity exceeded"); return }
      upstream.write(entry.body)
      entry.body = null
    }
    const receive = message => {
      if (!isObject(message) || (message.jsonrpc !== undefined && message.jsonrpc !== "2.0")) { close(1002, "Invalid Electrum response"); return }
      if (!Object.hasOwn(message, "id")) {
        if (Array.isArray(message.params) && ((message.method === "blockchain.headers.subscribe" && headersSubscribed) || (message.method === "blockchain.scripthash.subscribe" && subscriptions.has(message.params[0])))) send({ jsonrpc: "2.0", method: message.method, params: message.params })
        return
      }
      if (!Number.isSafeInteger(message.id) || (Object.hasOwn(message, "result") === Object.hasOwn(message, "error"))) { close(1002, "Invalid Electrum response"); return }
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id); clearTimeout(entry.timer)
      if (Object.hasOwn(message, "error")) { fail(message.id, -32001); return }
      if (entry.method === "blockchain.headers.subscribe") headersSubscribed = true
      if (entry.method === "blockchain.scripthash.subscribe") subscriptions.add(entry.subscription)
      if (entry.method === "blockchain.scripthash.unsubscribe") subscriptions.delete(entry.subscription)
      send({ jsonrpc: "2.0", id: message.id, result: message.result })
    }
    const attachTls = socket => {
      upstream = connectTls({
        ...(socket ? { socket } : { host: config.upstreamHost, port: config.upstreamPort }),
        ...(isIP(config.upstreamServername) ? {} : { servername: config.upstreamServername }),
        checkServerIdentity: (_hostname, certificate) => checkServerIdentity(config.upstreamServername, certificate),
        ca: config.upstreamCa, rejectUnauthorized: true, minVersion: "TLSv1.2",
      })
      upstream.on("secureConnect", () => {
        clearTimeout(connectTimer)
        if (!upstream.authorized || closed) { close(1011, "Electrum TLS verification failed"); return }
        ready = true
        for (const entry of pending.values()) forward(entry)
      })
      upstream.on("error", () => close(1011, "Electrum TLS connection unavailable"))
      upstream.on("close", () => close(1011, "Electrum connection closed"))
      upstream.on("data", chunk => {
        if (closed || !ready) return
        if (incoming.length + chunk.length > RESPONSE_BYTES + 1) { close(1009, "Electrum response too large"); return }
        incoming = Buffer.concat([incoming, chunk])
        let end
        while (!closed && (end = incoming.indexOf(10)) !== -1) {
          const line = incoming.subarray(0, end)
          incoming = end + 1 === incoming.length ? Buffer.alloc(0) : incoming.subarray(end + 1)
          if (!line.length || line.length > RESPONSE_BYTES) { close(1002, "Invalid Electrum framing"); return }
          try { receive(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line))) } catch { close(1002, "Invalid Electrum response") }
        }
      })
    }
    const connect = () => {
      try { assertPolicy() } catch { close(1008, "Bridge routing blocked by local policy"); return }
      connectTimer = setTimeout(() => close(1011, "Electrum connection unavailable"), config.timeoutMs ?? 10000)
      if (!config.socksProxy) { attachTls(); return }
      const raw = connectTcp({ host: config.socksProxy.host, port: config.socksProxy.port })
      upstream = raw
      raw.on("error", () => close(1011, "SOCKS connection unavailable"))
      raw.once("connect", () => {
        void SocksClient.createConnection({ command: "connect", proxy: { type: 5, ...config.socksProxy }, destination: { host: config.upstreamHost, port: config.upstreamPort }, existing_socket: raw, timeout: config.timeoutMs ?? 10000 }).then(({ socket }) => {
          if (closed) socket.destroy()
          else attachTls(socket)
        }).catch(error => {
          const reason = / - (Failure|NotAllowed|NetworkUnreachable|HostUnreachable|ConnectionRefused|TTLExpired|CommandNotSupported|AddressNotSupported)$/.exec(error instanceof Error ? error.message : "")?.[1]
          close(1011, reason ? `SOCKS rejected: ${reason}` : "SOCKS connection unavailable")
        })
      })
    }
    const heartbeat = setInterval(() => { if (!alive) { close(); return } alive = false; ws.ping() }, 30000)
    heartbeat.unref()
    ws.on("pong", () => { alive = true })
    ws.on("error", () => close(1002))
    ws.on("close", () => close())
    ws.on("message", (bytes, binary) => {
      if (closed) return
      if (binary || bytes.length > REQUEST_BYTES) { close(1003, "Text JSON requests required"); return }
      const now = performance.now()
      if (now - windowStarted >= 10000) { windowStarted = now; windowRequests = 0 }
      if (++windowRequests > 120) { close(1008, "Bridge request rate exceeded"); return }
      let request
      try { request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { close(1002, "Invalid JSON request"); return }
      const invalid = validateRequest(request)
      if (invalid) { fail(Number.isSafeInteger(request?.id) ? request.id : null, invalid === "method-not-allowed" ? -32601 : -32602); return }
      if (request.id <= lastRequestId || pending.has(request.id) || pending.size >= 64) { close(1008, "Bridge request capacity exceeded"); return }
      lastRequestId = request.id
      const subscribing = request.method === "blockchain.scripthash.subscribe"
      if (subscribing && subscriptions.size + [...pending.values()].filter(entry => entry.method === request.method).length >= 128) { fail(request.id, -32000); return }
      const timer = setTimeout(() => { pending.delete(request.id); fail(request.id, -32002); close(1011, "Electrum request timeout") }, config.timeoutMs ?? 10000)
      const entry = { body: `${JSON.stringify(request)}\n`, timer, method: request.method, subscription: request.params[0] }
      pending.set(request.id, entry)
      if (!upstream) connect()
      else if (ready) forward(entry)
    })
  })
  return {
    listen: () => new Promise((resolve, reject) => { assertPolicy(); server.once("error", reject); server.listen(config.port, config.host, () => { server.removeListener("error", reject); resolve(server.address()) }) }),
    close: async () => {
      for (const session of sessions) session.close()
      for (const ws of wss.clients) ws.terminate()
      await new Promise(resolve => wss.close(resolve))
      server.closeAllConnections()
      if (server.listening) await new Promise(resolve => server.close(resolve))
    },
  }
}
