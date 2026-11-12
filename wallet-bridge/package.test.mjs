import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { certificate, privateKey, installFixtures } from "./test-fixtures.mjs"
import { readMachinePolicy } from "./policy.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(new URL("../package.json", import.meta.url))
const noNetwork = path.join(root, "test-no-network.mjs")
installFixtures()

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/ERR_PNPM_[A-Z_]+|Unknown option: '[a-z-]+'/)?.[0]
  assert.equal(result.status, 0, `${path.basename(command)} failed: ${diagnostic ?? result.error?.code ?? result.status}; no automatic network fallback is permitted`)
  return result.stdout
}

async function offlineDependencies(directory) {
  const files = new Map(), versions = new Map()
  async function collect(name, resolver) {
    const manifestFile = resolver.resolve(`${name}/package.json`)
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"))
    if (files.has(name)) { assert.equal(versions.get(name), manifest.version); return }
    const packed = JSON.parse(run("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", directory], path.dirname(manifestFile)))[0]
    assert.equal(path.basename(packed.filename), packed.filename)
    files.set(name, `file:${path.join(directory, packed.filename)}`)
    versions.set(name, manifest.version)
    const dependencies = createRequire(manifestFile)
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await collect(dependency, dependencies)
  }
  const bridgeRequire = createRequire(path.join(root, "package.json"))
  for (const name of ["socks", "ws"]) await collect(name, bridgeRequire)
  for (const name of ["typescript", "@types/node"]) await collect(name, require)
  return Object.fromEntries(files)
}

test("packed package works as an isolated ESM, typed and CLI dependency", { timeout: 180000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "bitbudget-bridge-consumer-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const packed = JSON.parse(run("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", directory], root))[0]
  assert.deepEqual(packed.files.map(file => file.path).sort(), ["bridge.mjs", "index.d.mts", "index.mjs", "package.json", "policy.mjs", "protocol.mjs", "server.mjs", "upstream-config.mjs"].sort())
  assert.equal(path.basename(packed.filename), packed.filename)
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(manifest.private, true)
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["socks", "ws"])
  const dependencies = await offlineDependencies(directory)
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "bitbudget-electrum-bridge": `file:${path.join(directory, packed.filename)}` }, devDependencies: { typescript: dependencies.typescript, "@types/node": dependencies["@types/node"], ws: dependencies.ws }, pnpm: { overrides: dependencies } }))
  run("pnpm", ["install", "--offline", "--ignore-scripts", "--ignore-workspace"], directory)
  const imported = run(process.execPath, ["--import", noNetwork, "--input-type=module", "-e", 'import { createElectrumBridge, BridgePolicyError } from "bitbudget-electrum-bridge"; if(typeof createElectrumBridge!=="function" || typeof BridgePolicyError!=="function")process.exit(1); console.log("inert-import");'], directory)
  assert.match(imported, /inert-import/)
  const help = run(path.join(directory, "node_modules", ".bin", "bitbudget-electrum-bridge"), ["--help"], directory, { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(noNetwork).href}` })
  assert.match(help, /--policy-file/)
  assert.match(help, /createElectrumBridge/)
  await writeFile(path.join(directory, "allow.json"), JSON.stringify({ version: 1, denySocks: false, denyOnion: false }))
  if (readMachinePolicy().denySocks) {
    const denied = run(process.execPath, ["--import", noNetwork, "--input-type=module", "-e", 'import { createElectrumBridge, BridgePolicyError } from "bitbudget-electrum-bridge"; try { createElectrumBridge({mode:"loopback-development",host:"127.0.0.1",port:0,upstreamHost:"127.0.0.1",upstreamPort:50002,upstreamServername:"electrum.test",allowedOrigins:["http://localhost:3001"],policyFile:"allow.json",socksProxy:{host:"127.0.0.1",port:9050}}); process.exit(1); } catch(error) { if(!(error instanceof BridgePolicyError)||error.code!=="ERR_BRIDGE_SOCKS_DENIED")throw error; console.log(error.code); }'], directory)
    assert.match(denied, /ERR_BRIDGE_SOCKS_DENIED/)
    const cli = spawnSync(process.execPath, ["--import", noNetwork, path.join(directory, "node_modules", "bitbudget-electrum-bridge", "server.mjs"), "--policy-file", "allow.json", "--upstream-host", "127.0.0.1", "--upstream-servername", "electrum.test", "--socks-proxy", "socks5h://127.0.0.1:9050", "--origin", "http://localhost:3001", "--loopback-development"], { cwd: directory, encoding: "utf8", timeout: 10000 })
    assert.equal(cli.status, 1)
    assert.match(cli.stderr, /ERR_BRIDGE_SOCKS_DENIED/)
  }
  await writeFile(path.join(directory, "consumer.mts"), 'import { createElectrumBridge, BridgePolicyError, type BridgeConfig, type ElectrumBridge } from "bitbudget-electrum-bridge";\nconst config: BridgeConfig = {mode:"loopback-development",host:"127.0.0.1",port:0,upstreamHost:"127.0.0.1",upstreamPort:50002,upstreamServername:"electrum.test",allowedOrigins:["http://localhost:3001"]};\nconst bridge: ElectrumBridge = createElectrumBridge(config);\nconst address: Promise<import("node:net").AddressInfo> = bridge.listen();\nvoid address; void bridge.close(); void new BridgePolicyError("ERR_BRIDGE_SOCKS_DENIED");\n')
  const typeArgs = [path.join(directory, "node_modules", "typescript", "lib", "tsc.js"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--types", "node"]
  run(process.execPath, [...typeArgs, "consumer.mts"], directory)
  await writeFile(path.join(directory, "invalid.mts"), 'import { createElectrumBridge } from "bitbudget-electrum-bridge"; createElectrumBridge({mode:"tls",host:"0.0.0.0",port:443,upstreamHost:"127.0.0.1",upstreamPort:50002,upstreamServername:"electrum.test",allowedOrigins:["https://budget.example"]});')
  const invalid = spawnSync(process.execPath, [...typeArgs, "invalid.mts"], { cwd: directory, encoding: "utf8", timeout: 30000 })
  assert.equal(invalid.status, 2)
  assert.match(invalid.stdout, /TS2345/)
  assert.match(invalid.stdout, /tlsKey/)
  await writeFile(path.join(directory, "cert.pem"), certificate)
  await writeFile(path.join(directory, "key.pem"), privateKey, { mode: 0o600 })
  await writeFile(path.join(directory, "direct.mjs"), `import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:tls"
import { once } from "node:events"
import { WebSocket } from "ws"
import { createElectrumBridge } from "bitbudget-electrum-bridge"
const cert=await readFile("cert.pem"), key=await readFile("key.pem")
const sockets=new Set()
const upstream=createServer({cert,key},socket=>{sockets.add(socket);socket.on("error",()=>{});socket.on("close",()=>sockets.delete(socket));let text="";socket.on("data",chunk=>{text+=chunk.toString();if(text.includes("\\n")){const request=JSON.parse(text.trim());socket.write(JSON.stringify({id:request.id,result:null})+"\\n");text=""}})})
await new Promise(resolve=>upstream.listen(0,"127.0.0.1",resolve))
let bridge,ws
try {
  bridge=createElectrumBridge({mode:"loopback-development",host:"127.0.0.1",port:0,upstreamHost:"127.0.0.1",upstreamPort:upstream.address().port,upstreamServername:"electrum.test",upstreamCa:cert,allowedOrigins:["http://localhost:3001"]})
  const address=await bridge.listen()
  ws=new WebSocket("ws://127.0.0.1:"+address.port+"/electrum",{headers:{Origin:"http://localhost:3001"}})
  await once(ws,"open")
  const received=once(ws,"message")
  ws.send(JSON.stringify({jsonrpc:"2.0",id:1,method:"server.ping",params:[]}))
  assert.deepEqual(JSON.parse((await received)[0].toString()),{jsonrpc:"2.0",id:1,result:null})
  console.log("installed-direct-TLS-passed")
} finally {ws?.terminate();await bridge?.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>upstream.close(resolve));key.fill(0)}
`)
  assert.match(run(process.execPath, ["direct.mjs"], directory), /installed-direct-TLS-passed/)
})
