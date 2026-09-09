import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import { WebSocket } from "ws"

const { values } = parseArgs({ options: { url: { type: "string", default: "ws://127.0.0.1:50004/electrum" }, origin: { type: "string", default: "http://localhost:3001" } } })
const url = new URL(values.url)
if (url.username || url.password || url.search || url.hash || url.pathname !== "/electrum" || (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Expected a secure bridge or explicit loopback development bridge")
const socket = new WebSocket(url, { headers: { Origin: values.origin }, maxPayload: 2097152, rejectUnauthorized: true })
const result = await new Promise((resolve, reject) => {
  const pending = new Map()
  const timer = setTimeout(() => { socket.terminate(); reject(new Error("Read-only bridge probe timed out")) }, 60000)
  socket.on("open", () => {
    for (const [id, method, params] of [[1, "server.version", ["BitBudget", "1.4"]], [2, "server.features", []], [3, "blockchain.headers.subscribe", []], [4, "blockchain.block.header", [0]]]) socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
  })
  socket.on("error", () => { clearTimeout(timer); reject(new Error("Read-only bridge connection failed")) })
  socket.on("close", (code, reason) => {
    clearTimeout(timer)
    const safeReasons = new Set(["SOCKS connection unavailable", "Electrum TLS connection unavailable", "Electrum request timeout", "Electrum connection unavailable", "Electrum connection closed", "Invalid Electrum response"])
    const message = safeReasons.has(reason.toString()) || /^SOCKS rejected: (Failure|NotAllowed|NetworkUnreachable|HostUnreachable|ConnectionRefused|TTLExpired|CommandNotSupported|AddressNotSupported)$/.test(reason.toString()) ? reason.toString() : "Read-only bridge disconnected"
    if (pending.size !== 4) reject(new Error(`${message} (close code ${code})`))
  })
  socket.on("message", data => {
    try {
      const message = JSON.parse(data.toString())
      if (message.error) throw new Error("Electrum request rejected")
      if (Number.isInteger(message.id) && message.id >= 1 && message.id <= 4) pending.set(message.id, message.result)
      if (pending.size !== 4) return
      clearTimeout(timer)
      const header = pending.get(4)
      if (typeof header !== "string" || !/^[a-fA-F0-9]{160}$/.test(header)) throw new Error("Invalid genesis header")
      const hash = createHash("sha256").update(createHash("sha256").update(Buffer.from(header, "hex")).digest()).digest().reverse().toString("hex")
      const mainnet = hash === "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"
      const claimMatches = pending.get(2)?.genesis_hash === hash
      socket.close()
      if (!mainnet || !claimMatches) throw new Error("Mainnet genesis identity mismatch")
      const versions = pending.get(1)
      const server = Array.isArray(versions) && typeof versions[0] === "string" ? versions[0].slice(0, 128).replace(/[\u0000-\u001f\u007f]/g, "") : null
      const height = pending.get(3)?.height
      resolve({ readOnly: true, server, observedHeight: Number.isSafeInteger(height) ? height : null, genesisHeaderHash: hash, mainnetGenesisMatches: true, consensusVerified: false })
    } catch { clearTimeout(timer); socket.terminate(); reject(new Error("Read-only Electrum probe failed validation")) }
  })
})
console.log(JSON.stringify(result))
