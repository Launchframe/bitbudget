import { after, before } from "node:test"
import { createServer } from "node:tls"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { createElectrumBridge } from "./bridge.mjs"

let directory
export let certificate, privateKey
export const origin = "http://localhost:3001"
export const request = (id, method = "server.ping", params = []) => JSON.stringify({ jsonrpc: "2.0", id, method, params })
export const reply = (socket, id, result) => socket.write(`${JSON.stringify({ id, result })}\n`)

export function installFixtures() {
  before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bitbudget-electrum-bridge-test-"))
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(directory, "key.pem"), "-out", path.join(directory, "cert.pem"), "-days", "2", "-subj", "/CN=electrum.test", "-addext", "subjectAltName=DNS:electrum.test,IP:127.0.0.1"], { stdio: "pipe" })
    certificate = await readFile(path.join(directory, "cert.pem"))
    privateKey = await readFile(path.join(directory, "key.pem"))
  })
  after(async () => { privateKey?.fill(0); if (directory) await rm(directory, { recursive: true, force: true }) })
}

export async function fixture(t, handle, overrides = {}) {
  const requests = [], sockets = new Set(), clients = new Set()
  const upstream = createServer({ key: privateKey, cert: certificate }, socket => {
    sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", data => {
      buffer += data.toString()
      let newline
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const value = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
        requests.push(value)
        handle?.(socket, value)
      }
    })
  })
  let bridge
  t.after(async () => {
    for (const socket of clients) socket.terminate()
    await bridge?.close()
    for (const socket of sockets) socket.destroy()
    if (upstream.listening) await new Promise(resolve => upstream.close(resolve))
  })
  upstream.on("tlsClientError", () => {})
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve))
  const config = { mode: "loopback-development", host: "127.0.0.1", port: 0, allowedOrigins: [origin], upstreamHost: "127.0.0.1", upstreamPort: upstream.address().port, upstreamServername: "electrum.test", upstreamCa: certificate, timeoutMs: 1500, ...overrides }
  bridge = createElectrumBridge(config)
  const address = await bridge.listen()
  function client(headers = { Origin: origin }, suffix = "/electrum") {
    const ws = new WebSocket(`${config.mode === "tls" ? "wss" : "ws"}://127.0.0.1:${address.port}${suffix}`, { headers, ca: certificate, servername: "electrum.test" })
    ws.on("error", () => {})
    clients.add(ws)
    return ws
  }
  return { bridge, client, requests, config, address }
}
