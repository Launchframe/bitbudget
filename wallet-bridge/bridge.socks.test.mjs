import assert from "node:assert/strict"
import { test } from "node:test"
import { createServer as createTcpServer, connect as connectTcp } from "node:net"
import dns from "node:dns"
import { once } from "node:events"
import { validateConfig } from "./bridge.mjs"
import { parseElectrumTls, parseSocksProxy } from "./upstream-config.mjs"
import { assertRoutingAllowed, readMachinePolicy } from "./policy.mjs"
import { request, reply, fixture, installFixtures } from "./test-fixtures.mjs"

const policy = readMachinePolicy()
const permitted = process.env.BRIDGE_SOCKS_TESTS === "1" && !policy.denySocks && !policy.denyOnion
if (permitted) installFixtures()

test("onion routing requires SOCKS and never resolves the onion hostname locally", { skip: permitted ? false : "SOCKS integration requires explicit opt-in and a permitting local policy" }, async t => {
  const onion = `${"a".repeat(56)}.onion`
  assert.deepEqual(parseElectrumTls(`ssl://${onion}:50002`), { host: onion, port: 50002 })
  assert.throws(() => parseElectrumTls(`tcp://${onion}:50001`))
  assert.throws(() => parseElectrumTls(`ssl://user:secret@${onion}:50002`))
  assert.throws(() => parseSocksProxy("socks5://127.0.0.1:9050"))
  const lookups = []
  const originalLookup = dns.lookup
  t.mock.method(dns, "lookup", (host, ...args) => { lookups.push(host); return originalLookup(host, ...args) })
  for (const rejectProxy of [false, true]) {
    assertRoutingAllowed(readMachinePolicy(), { upstreamHost: onion, socksProxy: {} })
    const sockets = new Set(), destinations = []
    const proxy = createTcpServer(socket => {
      sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket))
      let pending = Buffer.alloc(0), greeted = false
      const receive = data => {
        pending = Buffer.concat([pending, data])
        if (!greeted) {
          if (pending.length < 2 || pending.length < pending[1] + 2) return
          assert.equal(pending[0], 5)
          pending = pending.subarray(pending[1] + 2); greeted = true
          socket.write(Buffer.from([5, 0]))
        }
        if (pending.length < 5) return
        assert.equal(pending[0], 5); assert.equal(pending[1], 1); assert.equal(pending[3], 3)
        const length = pending[4]
        if (pending.length < length + 7) return
        destinations.push(pending.subarray(5, 5 + length).toString())
        const port = pending.readUInt16BE(5 + length)
        socket.removeListener("data", receive)
        if (rejectProxy) { socket.end(Buffer.from([5, 4, 0, 1, 0, 0, 0, 0])); return }
        const target = connectTcp({ host: "127.0.0.1", port })
        sockets.add(target); target.on("error", () => socket.destroy()); target.on("close", () => sockets.delete(target))
        target.once("connect", () => { socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); socket.pipe(target); target.pipe(socket) })
      }
      socket.on("data", receive)
    })
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve))
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)) })
    const f = await fixture(t, (socket, value) => reply(socket, value.id, null), { upstreamHost: onion, socksProxy: parseSocksProxy(`socks5h://127.0.0.1:${proxy.address().port}`) })
    assert.throws(() => validateConfig({ ...f.config, socksProxy: undefined }))
    const ws = f.client(); await once(ws, "open")
    if (rejectProxy) {
      const ended = new Promise(resolve => ws.once("close", code => resolve(code)))
      ws.send(request(1)); assert.equal(await ended, 1011); assert.equal(f.requests.length, 0)
    } else {
      const received = once(ws, "message"); ws.send(request(1))
      assert.deepEqual(JSON.parse((await received)[0].toString()), { jsonrpc: "2.0", id: 1, result: null })
    }
    assert.deepEqual(destinations, [onion])
  }
  assert.equal(lookups.includes(onion), false)
})
