import assert from "node:assert/strict"
import { test } from "node:test"
import { once } from "node:events"
import { validateConfig } from "./bridge.mjs"
import { RESPONSE_BYTES, validateRequest } from "./protocol.mjs"
import { certificate, privateKey, origin, request, reply, fixture, installFixtures } from "./test-fixtures.mjs"

installFixtures()

test("configuration refuses cleartext LAN bindings and non-local development origins", () => {
  const config = { mode: "loopback-development", host: "127.0.0.1", port: 50004, upstreamHost: "127.0.0.1", upstreamPort: 50002, upstreamServername: "electrum.test", upstreamCa: certificate, allowedOrigins: [origin] }
  assert.doesNotThrow(() => validateConfig(config))
  assert.throws(() => validateConfig({ ...config, host: "0.0.0.0" }))
  assert.throws(() => validateConfig({ ...config, allowedOrigins: ["https://remote.example"] }))
  assert.throws(() => validateConfig({ ...config, mode: "tls" }))
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  try { assert.throws(() => validateConfig(config)) } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous }
})

test("validates method-specific parameters and rejects RPC, broadcasting and arbitrary targets", () => {
  for (const method of ["blockchain.transaction.broadcast", "getwalletinfo", "stop", "server.add_peer"]) assert.equal(validateRequest(JSON.parse(request(1, method))), "method-not-allowed")
  assert.equal(validateRequest({ ...JSON.parse(request(1)), upstream: "evil" }), "invalid-request")
  assert.equal(validateRequest(JSON.parse(request(1, "blockchain.block.headers", [0, 1000000]))), "invalid-params")
  assert.equal(validateRequest(JSON.parse(request(1, "blockchain.scripthash.get_history", ["bad"]))), "invalid-params")
  assert.equal(validateRequest(JSON.parse(request(1, "server.version", ["BitBudget", "1.4"]))), null)
})

test("forwards only valid reads over verified TLS, correlates out-of-order replies and normalizes framing", async t => {
  const f = await fixture(t, (socket, value) => {
    if (value.id === 2) {
      reply(socket, 2, { genesis_hash: "00".repeat(32) })
      const text = `${JSON.stringify({ id: 1, result: ["fixture", "1.4"] })}\n`
      socket.write(text.slice(0, 7)); setTimeout(() => socket.write(text.slice(7)), 10)
    }
  })
  const ws = f.client(); await once(ws, "open")
  const messages = []
  const done = new Promise(resolve => ws.on("message", data => { messages.push(JSON.parse(data.toString())); if (messages.length === 2) resolve() }))
  ws.send(request(1, "server.version", ["BitBudget", "1.4"])); ws.send(request(2, "server.features"))
  await done
  assert.deepEqual(messages.map(message => message.id), [2, 1])
  assert.ok(messages.every(message => message.jsonrpc === "2.0"))
  assert.equal(f.requests.length, 2)
})

test("caller mutations cannot redirect a direct bridge or change its trust and origin settings", async t => {
  const ca = Buffer.from(certificate)
  const origins = [origin]
  const f = await fixture(t, (socket, value) => reply(socket, value.id, null), { upstreamCa: ca, allowedOrigins: origins })
  assert.equal(Object.hasOwn(f.bridge, "server"), false)
  f.config.upstreamHost = `${"a".repeat(56)}.onion`
  f.config.upstreamPort = 9050
  f.config.upstreamServername = "wrong.example"
  f.config.socksProxy = { host: "127.0.0.1", port: 9050 }
  origins[0] = "https://evil.example"
  ca.fill(0)
  const ws = f.client(); await once(ws, "open")
  const received = once(ws, "message"); ws.send(request(1))
  assert.equal(JSON.parse((await received)[0].toString()).result, null)
  assert.equal(f.requests.length, 1)
})

test("rejects hostile origins, Host headers and arbitrary paths before opening upstream TLS", async t => {
  const f = await fixture(t)
  for (const [headers, suffix] of [[{ Origin: "https://evil.example" }, "/electrum"], [{}, "/electrum"], [{ Origin: origin, Host: "evil.example" }, "/electrum"], [{ Origin: origin }, "/electrum?upstream=evil"]]) {
    const ws = f.client(headers, suffix)
    const [error] = await once(ws, "error")
    assert.match(error.message, /403/)
  }
  assert.equal(f.requests.length, 0)
})

test("denies broadcasts without forwarding them", async t => {
  const f = await fixture(t)
  const ws = f.client(); await once(ws, "open")
  const received = once(ws, "message")
  ws.send(request(1, "blockchain.transaction.broadcast", ["00"]))
  assert.equal(JSON.parse((await received)[0].toString()).error.code, -32601)
  assert.equal(f.requests.length, 0)
})

test("requires a trusted CA and matching TLS hostname before sending any Electrum data", async t => {
  for (const overrides of [{ upstreamCa: undefined }, { upstreamServername: "wrong.example" }]) {
    const f = await fixture(t, undefined, overrides)
    const ws = f.client(); await once(ws, "open")
    const ended = new Promise(resolve => ws.once("close", (code, reason) => resolve([code, reason.toString()])))
    ws.send(request(1))
    assert.equal((await ended)[0], 1011)
    assert.equal(f.requests.length, 0)
  }
})

test("validates a configured IP SAN without sending an IP as TLS SNI", async t => {
  const f = await fixture(t, (socket, value) => {
    assert.ok(!socket.servername)
    reply(socket, value.id, null)
  }, { upstreamServername: "127.0.0.1" })
  const ws = f.client(); await once(ws, "open")
  const received = once(ws, "message"); ws.send(request(1))
  assert.equal(JSON.parse((await received)[0].toString()).result, null)
  const wrong = await fixture(t, undefined, { upstreamServername: "127.0.0.2" })
  const rejected = wrong.client(); await once(rejected, "open")
  const ended = new Promise(resolve => rejected.once("close", code => resolve(code)))
  rejected.send(request(1)); assert.equal(await ended, 1011)
  assert.equal(wrong.requests.length, 0)
})

test("supports a TLS browser-facing listener with the same read-only policy", async t => {
  const f = await fixture(t, (socket, value) => reply(socket, value.id, null), { mode: "tls", tlsCert: certificate, tlsKey: privateKey, allowedOrigins: ["https://budget.example"], allowedHosts: ["bridge.example"] })
  const ws = f.client({ Origin: "https://budget.example", Host: "bridge.example" }); await once(ws, "open")
  const received = once(ws, "message"); ws.send(request(1))
  assert.deepEqual(JSON.parse((await received)[0].toString()), { jsonrpc: "2.0", id: 1, result: null })
})

test("relays only subscribed notifications", async t => {
  const f = await fixture(t, (socket, value) => {
    reply(socket, value.id, { height: 1, hex: "00".repeat(80) })
    socket.write(`${JSON.stringify({ method: "blockchain.headers.subscribe", params: [{ height: 2, hex: "11".repeat(80) }] })}\n`)
    socket.write(`${JSON.stringify({ method: "blockchain.scripthash.subscribe", params: ["22".repeat(32), "unused"] })}\n`)
  })
  const ws = f.client(); await once(ws, "open")
  const messages = []
  const done = new Promise(resolve => ws.on("message", data => { messages.push(JSON.parse(data.toString())); if (messages.length === 2) resolve() }))
  ws.send(request(1, "blockchain.headers.subscribe")); await done
  assert.equal(messages[1].method, "blockchain.headers.subscribe")
  assert.equal(messages.length, 2)
})

test("sanitizes upstream errors instead of echoing remote messages", async t => {
  const f = await fixture(t, (socket, value) => socket.write(`${JSON.stringify({ id: value.id, error: { code: -1, message: "fixture-sensitive-query" } })}\n`))
  const ws = f.client(); await once(ws, "open")
  const received = once(ws, "message"); ws.send(request(1))
  const body = (await received)[0].toString()
  assert.equal(JSON.parse(body).error.code, -32001)
  assert.equal(body.includes("fixture-sensitive-query"), false)
})

test("bounds response sizes and request lifetime", async t => {
  for (const handle of [(socket) => socket.write("x".repeat(RESPONSE_BYTES + 2)), () => {}]) {
    const f = await fixture(t, handle, { timeoutMs: 100 })
    const ws = f.client(); await once(ws, "open")
    const ended = new Promise(resolve => ws.once("close", code => resolve(code)))
    ws.send(request(1))
    assert.ok([1009, 1011].includes(await ended))
  }
})

test("rejects duplicate IDs, binary messages and malformed JSON", async t => {
  for (const attack of [ws => ws.send("{"), ws => ws.send(Buffer.from("binary")), ws => { ws.send(request(1)); ws.send(request(1)) }]) {
    const f = await fixture(t)
    const ws = f.client(); await once(ws, "open")
    const ended = new Promise(resolve => ws.once("close", code => resolve(code)))
    attack(ws)
    assert.ok([1002, 1003, 1008].includes(await ended))
  }
})
