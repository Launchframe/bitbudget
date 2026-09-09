import { chromium } from "@playwright/test"
import assert from "node:assert/strict"

const origin = "http://localhost:3001"
const bridge = "ws://127.0.0.1:50004/electrum"
const browser = await chromium.launch({ headless: true, executablePath: process.env.WALLET_PLAYWRIGHT_CHROMIUM || undefined })
try {
  const page = await browser.newPage()
  await page.goto(`${origin}/auth`)
  const result = await page.evaluate(bridge => new Promise((resolve, reject) => {
    const socket = new WebSocket(bridge)
    const received = new Map()
    const timer = setTimeout(() => { socket.close(); reject(new Error("Bridge browser timeout")) }, 60000)
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Bridge browser connection failed")) }
    socket.onopen = () => {
      for (const [id, method, params] of [[1, "server.version", ["BitBudget", "1.4"]], [2, "server.features", []], [3, "blockchain.headers.subscribe", []], [4, "blockchain.block.header", [0]]]) socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    }
    socket.onmessage = async event => {
      try {
        const message = JSON.parse(event.data)
        if (message.error) throw new Error("Bridge request rejected")
        if (Number.isInteger(message.id) && message.id >= 1 && message.id <= 4) received.set(message.id, message.result)
        if (received.size !== 4) return
        clearTimeout(timer); socket.close()
        const header = received.get(4)
        if (typeof header !== "string" || !/^[a-fA-F0-9]{160}$/.test(header)) throw new Error("Invalid header")
        const bytes = Uint8Array.from(header.match(/../g), byte => parseInt(byte, 16))
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await crypto.subtle.digest("SHA-256", bytes))).reverse()
        const genesis = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("")
        resolve({ genesis, claimMatches: received.get(2)?.genesis_hash === genesis, height: received.get(3)?.height, readOnly: true })
      } catch { clearTimeout(timer); socket.close(); reject(new Error("Invalid bridge response")) }
    }
  }), bridge)
  assert.equal(result.genesis, "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f")
  assert.equal(result.claimMatches, true)
  await page.goto("http://127.0.0.1:3001/auth")
  const rejected = await page.evaluate(bridge => new Promise(resolve => {
    const socket = new WebSocket(bridge)
    const timer = setTimeout(() => { socket.close(); resolve(false) }, 5000)
    socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(false) }
    socket.onerror = () => { clearTimeout(timer); resolve(true) }
  }), bridge)
  assert.equal(rejected, true)
  console.log(JSON.stringify({ result: "passed", browser: browser.version(), liveElectrum: true, readOnly: true, genesisMatches: true, observedHeight: result.height, unauthorizedOriginRejected: true, consensusVerified: false }))
} finally { await browser.close() }
