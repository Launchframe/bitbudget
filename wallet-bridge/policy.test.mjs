import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import net from "node:net"
import tls from "node:tls"
import http from "node:http"
import https from "node:https"
import dns from "node:dns"
import { syncBuiltinESMExports } from "node:module"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { once } from "node:events"
import { createElectrumBridge } from "./bridge.mjs"
import { BridgePolicyError, parsePolicy, readPolicyFile, mergePolicies, readMachinePolicy, assertRoutingAllowed } from "./policy.mjs"
import { parseElectrumTls, parseSocksProxy } from "./upstream-config.mjs"
import { fixture, installFixtures, request } from "./test-fixtures.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const allow = { version: 1, denySocks: false, denyOnion: false }
const deny = { version: 1, denySocks: true, denyOnion: true }
const base = { mode: "loopback-development", host: "127.0.0.1", port: 0, upstreamHost: "127.0.0.1", upstreamPort: 50002, upstreamServername: "electrum.test", allowedOrigins: ["http://localhost:3001"] }
installFixtures()

async function policyFiles(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "bridge-policy-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const allowFile = path.join(directory, "allow.json"), denyFile = path.join(directory, "deny.json")
  await writeFile(allowFile, JSON.stringify(allow))
  await writeFile(denyFile, JSON.stringify(deny))
  return { directory, allowFile, denyFile }
}

function noNetwork(t) {
  const calls = []
  for (const [target, methods] of [[net, ["connect", "createConnection", "createServer"]], [net.Server.prototype, ["listen"]], [tls, ["connect", "createServer"]], [http, ["createServer"]], [https, ["createServer"]], [dns, ["lookup", "resolve"]]]) {
    for (const method of methods) t.mock.method(target, method, () => { calls.push(method); throw new Error("Unexpected network operation") })
  }
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  return calls
}

test("strict policy parsing and deny-dominant combination are network-free", () => {
  assert.deepEqual(parsePolicy(JSON.stringify(deny)), deny)
  assert.deepEqual(mergePolicies(deny, allow), deny)
  assert.deepEqual(mergePolicies(allow, deny), deny)
  assert.deepEqual(mergePolicies(), allow)
  for (const text of ["", "null", "[]", "{}", JSON.stringify({ ...deny, version: 2 }), JSON.stringify({ ...deny, denySocks: "false" }), JSON.stringify({ ...deny, extra: true }), " ".repeat(4097)]) {
    assert.throws(() => parsePolicy(text), { name: "BridgePolicyError", code: "ERR_BRIDGE_POLICY_INVALID" })
  }
  assert.doesNotThrow(() => assertRoutingAllowed(allow, { socksProxy: {}, upstreamHost: "fixture.onion" }))
  for (const host of ["fixture.onion", "FIXTURE.ONION", "fixture.onion."]) {
    assert.throws(() => assertRoutingAllowed(deny, { upstreamHost: host }), { code: "ERR_BRIDGE_ONION_DENIED" })
    assert.throws(() => assertRoutingAllowed(deny, { upstreamServername: host }), { code: "ERR_BRIDGE_ONION_DENIED" })
  }
  const onion = `${"a".repeat(56)}.onion`
  assert.deepEqual(parseElectrumTls(`ssl://${onion}:50002`), { host: onion, port: 50002 })
  assert.throws(() => parseElectrumTls(`tcp://${onion}:50001`))
  assert.throws(() => parseSocksProxy("socks5://127.0.0.1:9050"))
})

test("only an absent optional policy is allowed; bad files and inaccessible policies fail closed", async t => {
  const { directory, denyFile } = await policyFiles(t)
  const missing = path.join(directory, "missing.json")
  assert.deepEqual(readPolicyFile(missing, true), allow)
  assert.throws(() => readPolicyFile(missing), { code: "ERR_BRIDGE_POLICY_INVALID" })
  assert.throws(() => readPolicyFile(directory, true), { code: "ERR_BRIDGE_POLICY_INVALID" })
  const broken = path.join(directory, "broken.json")
  await symlink(missing, broken)
  assert.throws(() => readPolicyFile(broken, true), { code: "ERR_BRIDGE_POLICY_INVALID" })
  await writeFile(denyFile, Buffer.from([0xff]))
  assert.throws(() => readPolicyFile(denyFile), { code: "ERR_BRIDGE_POLICY_INVALID" })
  await writeFile(denyFile, " ".repeat(4097))
  assert.throws(() => readPolicyFile(denyFile), { code: "ERR_BRIDGE_POLICY_INVALID" })
  t.mock.method(fs, "openSync", () => { throw Object.assign(new Error("private path"), { code: "EACCES" }) })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  assert.throws(() => readPolicyFile(missing, true), error => error instanceof BridgePolicyError && !error.message.includes("private path"))
})

test("API denial happens before server creation, DNS, TCP or TLS", async t => {
  const { denyFile } = await policyFiles(t)
  const calls = noNetwork(t)
  assert.throws(() => createElectrumBridge({ ...base, policyFile: denyFile, socksProxy: { host: "127.0.0.1", port: 9050 } }), { code: "ERR_BRIDGE_SOCKS_DENIED" })
  assert.throws(() => createElectrumBridge({ ...base, policyFile: denyFile, upstreamHost: `${"a".repeat(56)}.onion` }), { code: "ERR_BRIDGE_ONION_DENIED" })
  assert.throws(() => createElectrumBridge({ ...base, policyFile: "" }), { code: "ERR_BRIDGE_POLICY_INVALID" })
  assert.deepEqual(calls, [])
})

test("additional policy options cannot override environment or canonical denials", async t => {
  const { allowFile, denyFile } = await policyFiles(t)
  const canonical = readMachinePolicy()
  const previous = process.env.BITBUDGET_BRIDGE_POLICY_FILE
  t.after(() => { if (previous === undefined) delete process.env.BITBUDGET_BRIDGE_POLICY_FILE; else process.env.BITBUDGET_BRIDGE_POLICY_FILE = previous })
  process.env.BITBUDGET_BRIDGE_POLICY_FILE = denyFile
  assert.deepEqual(readMachinePolicy(allowFile), deny)
  process.env.BITBUDGET_BRIDGE_POLICY_FILE = allowFile
  assert.deepEqual(readMachinePolicy(allowFile), mergePolicies(canonical, allow))
  const calls = noNetwork(t)
  assert.throws(() => createElectrumBridge({ ...base, policyFile: denyFile, socksProxy: { host: "127.0.0.1", port: 9050 } }), { code: "ERR_BRIDGE_SOCKS_DENIED" })
  process.env.BITBUDGET_BRIDGE_POLICY_FILE = ""
  assert.throws(() => readMachinePolicy(), { code: "ERR_BRIDGE_POLICY_INVALID" })
  assert.deepEqual(calls, [])
})

test("policy is rechecked before listening", async t => {
  const { allowFile } = await policyFiles(t)
  const bridge = createElectrumBridge({ ...base, policyFile: allowFile })
  t.after(() => bridge.close())
  await writeFile(allowFile, "invalid")
  const calls = noNetwork(t)
  await assert.rejects(bridge.listen(), { code: "ERR_BRIDGE_POLICY_INVALID" })
  assert.deepEqual(calls, [])
})

test("policy is rechecked before opening an upstream connection", async t => {
  const { allowFile } = await policyFiles(t)
  const f = await fixture(t, undefined, { policyFile: allowFile })
  await writeFile(allowFile, "invalid")
  const ws = f.client(); await once(ws, "open")
  const ended = new Promise(resolve => ws.once("close", code => resolve(code)))
  const connected = t.mock.method(tls, "connect", () => { throw new Error("Unexpected TLS connection") })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  ws.send(request(1))
  assert.equal(await ended, 1008)
  assert.equal(connected.mock.callCount(), 0)
  assert.equal(f.requests.length, 0)
})

test("CLI refuses a denied route before reading certificates or opening sockets", async t => {
  const { directory, denyFile } = await policyFiles(t)
  const result = spawnSync(process.execPath, ["--import", path.join(root, "test-no-network.mjs"), path.join(root, "server.mjs"), "--policy-file", denyFile, "--upstream-host", "127.0.0.1", "--upstream-servername", "electrum.test", "--socks-proxy", "socks5h://127.0.0.1:9050", "--upstream-ca", path.join(directory, "missing-certificate.pem"), "--origin", "http://localhost:3001", "--loopback-development"], { cwd: directory, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ERR_BRIDGE_SOCKS_DENIED/)
  assert.doesNotMatch(result.stderr, /Unexpected network|missing-certificate|127\.0\.0\.1/)
})
