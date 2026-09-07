import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const GROUPS = ["monitor", "signer", "blake2b", "advanced"]
const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const ASSET_URL = /^\/_next\/static\/(?:chunks\/(?:turbopack-)?[a-f0-9]{16,64}\.(?:js|css)|media\/[a-zA-Z0-9_-]+\.[a-f0-9]{8,64}\.(?:wasm|woff2|svg|png|webp))$/
const ROOT_MARKER = /^bitbudget-wallet-assets:(monitor|signer|blake2b|advanced)(:worker)?:v1$/
const digest = (data) => createHash("sha256").update(data).digest("hex")

export function walletModuleGroup(moduleId) {
  const match = /^\[project\]\/lib\/wallet\/(monitor|signer|blake2b|advanced)(?:\/[^<>]+|(?:-entry)?\.[cm]?[jt]sx?)(?: <module evaluation>)?$/.exec(moduleId)
  return match?.[1] ?? null
}

export function parseClientReferenceManifest(source) {
  const prefix = "globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};"
  if (!source.startsWith(prefix)) throw new Error("Unsupported Next client-reference manifest format")
  const assignment = source.slice(prefix.length).trim()
  const match = /^globalThis\.__RSC_MANIFEST\["(?:[^"\\]|\\.)*"\] = (\{[\s\S]*\});?$/.exec(assignment)
  if (!match) throw new Error("Unsupported Next client-reference manifest assignment")
  const manifest = JSON.parse(match[1])
  if (!manifest.clientModules || typeof manifest.clientModules !== "object" || Array.isArray(manifest.clientModules)) {
    throw new Error("Missing client module graph")
  }
  return manifest.clientModules
}

async function manifestFiles(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await manifestFiles(filename))
    else if (entry.isFile() && entry.name.endsWith("_client-reference-manifest.js")) result.push(filename)
  }
  return result.sort()
}

export function parseTurbopackChunk(source, filename = "chunk.js") {
  const virtual = `/__wallet_artifacts__/${filename}`
  const file = ts.createSourceFile(virtual, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (file.parseDiagnostics.length) throw new Error("Invalid emitted JavaScript")
  const options = { allowJs: true, noLib: true, noResolve: true, target: ts.ScriptTarget.Latest }
  const host = { ...ts.createCompilerHost(options), getCurrentDirectory: () => "/", getSourceFile: name => name === virtual ? file : undefined, fileExists: name => name === virtual, readFile: name => name === virtual ? source : undefined }
  const checker = ts.createProgram([virtual], options, host).getTypeChecker()
  const modules = []
  const number = node => ts.isNumericLiteral(node) ? Number(node.text) : null
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "push" &&
      node.expression.expression.getText(file).includes("globalThis.TURBOPACK") && node.arguments.length === 1 && ts.isArrayLiteralExpression(node.arguments[0])) {
      const elements = node.arguments[0].elements
      let ids = []
      for (const item of elements.slice(1)) {
        const id = number(item)
        if (id !== null) { ids.push(id); continue }
        if (ts.isObjectLiteralExpression(item) && !ids.length) {
          const metadata = {}
          for (const property of item.properties) {
            if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) || !["otherChunks", "runtimeModuleIds"].includes(property.name.text) || !ts.isArrayLiteralExpression(property.initializer)) throw new Error("Unsupported Turbopack entry metadata")
            metadata[property.name.text] = property.initializer.elements.map(value => {
              if (property.name.text === "otherChunks" && ts.isStringLiteralLike(value) && ASSET_URL.test(`/_next/${value.text}`)) return value.text
              if (property.name.text === "runtimeModuleIds" && number(value) !== null) return number(value)
              throw new Error("Unsupported Turbopack entry dependency")
            })
          }
          if (!metadata.otherChunks || !metadata.runtimeModuleIds) throw new Error("Incomplete Turbopack entry metadata")
          modules.push({ ids: [], imports: new Set(metadata.runtimeModuleIds), deferred: new Set(), lazy: new Set(), loaderTargets: new Set(), assets: new Set(metadata.otherChunks.map(url => `/_next/${url}`)), groups: new Set(), worker: true, methods: new Set() })
          continue
        }
        if (!ids.length || !(ts.isArrowFunction(item) || ts.isFunctionExpression(item)) || (item.parameters.length && !ts.isIdentifier(item.parameters[0].name))) throw new Error(`Unsupported Turbopack module registration in ${filename}: ${ts.SyntaxKind[item.kind]}`)
        const context = item.parameters.length ? checker.getSymbolAtLocation(item.parameters[0].name) : null
        const record = { ids, imports: new Set(), deferred: new Set(), lazy: new Set(), loaderTargets: new Set(), assets: new Set(), groups: new Set(), worker: false, unresolved: false, methods: new Set() }
        function loaderTargets(node, parameter) {
          if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && checker.getSymbolAtLocation(node.expression) === parameter) || (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && checker.getSymbolAtLocation(node.expression.expression) === parameter && ["i", "r"].includes(node.expression.name.text)))) {
            const target = node.arguments.length === 1 ? number(node.arguments[0]) : null
            if (target === null) throw new Error("Nonliteral lazy module target")
            record.loaderTargets.add(target)
          }
          ts.forEachChild(node, child => loaderTargets(child, parameter))
        }
        function walk(child, deferred = false) {
          if (ts.isFunctionLike(child) && ts.isCallExpression(child.parent) && ts.isPropertyAccessExpression(child.parent.expression) && child.parent.expression.name.text === "then") deferred = true
          if (ts.isStringLiteralLike(child)) {
            const marker = ROOT_MARKER.exec(child.text)
            if (marker) { record.groups.add(marker[1]); record.worker ||= Boolean(marker[2]) }
            const url = child.text.startsWith("static/") ? `/_next/${child.text}` : child.text
            if (ASSET_URL.test(url)) record.assets.add(url)
            else if (/^(?:\/_next\/static\/|static\/(?:chunks|media)\/)/.test(child.text)) record.unresolved = true
          }
          if (context && ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) &&
            ts.isIdentifier(child.expression.expression) && checker.getSymbolAtLocation(child.expression.expression) === context) {
            const method = child.expression.name.text
            record.methods.add(method)
            if (method === "s" && child.arguments.length === 2 && number(child.arguments[1]) !== null && !record.ids.includes(number(child.arguments[1]))) record.ids.push(number(child.arguments[1]))
            if (method === "v" && child.arguments.length === 1 && ts.isArrowFunction(child.arguments[0]) && child.arguments[0].parameters.length === 1 && ts.isIdentifier(child.arguments[0].parameters[0].name)) loaderTargets(child.arguments[0].body, checker.getSymbolAtLocation(child.arguments[0].parameters[0].name))
            if (["i", "r", "A"].includes(method)) {
              const dependency = child.arguments.length === 1 ? number(child.arguments[0]) : null
              if (dependency === null) record.unresolved = true
              else (method === "A" ? record.lazy : deferred ? record.deferred : record.imports).add(dependency)
            }
          }
          ts.forEachChild(child, next => walk(next, deferred))
        }
        walk(item.body)
        modules.push(record)
        ids = []
      }
      if (ids.length) throw new Error("Incomplete Turbopack module registration")
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return modules
}

async function emittedGraph(next) {
  const records = new Map()
  const chunks = new Map()
  for (const file of (await readdir(path.join(next, "static/chunks"))).sort()) {
    const url = `/_next/static/chunks/${file}`
    if (!ASSET_URL.test(url) || !file.endsWith(".js")) continue
    const source = await readFile(path.join(next, "static/chunks", file), "utf8")
    const modules = parseTurbopackChunk(source, file)
    chunks.set(url, modules)
    for (const record of modules) for (const id of record.ids) {
      if (!records.has(id)) records.set(id, [])
      records.get(id).push({ ...record, url })
    }
  }
  return { records, chunks }
}

async function completeManifest(next, buildId, graph, eager) {
  const roots = new Map(GROUPS.map(group => [group, new Set()]))
  const rootGroups = new Map()
  for (const [id, records] of graph.records) for (const record of records) for (const group of record.groups) {
    if (eager.has(record.url)) throw new Error("Wallet code leaked into the eager application bundle")
    if (rootGroups.has(id) && rootGroups.get(id) !== group) throw new Error("Conflicting wallet group roots")
    roots.get(group).add(id)
    rootGroups.set(id, group)
  }
  if (!roots.get("monitor").size || !roots.get("signer").size) throw new Error("Missing wallet group roots")
  const boundaries = new Map([...graph.records.keys()].map(id => [id, new Set(rootGroups.has(id) ? [rootGroups.get(id)] : [])]))
  let changed = true
  while (changed) {
    changed = false
    for (const [id, records] of graph.records) {
      if (rootGroups.has(id)) continue
      const targets = boundaries.get(id)
      for (const record of records) for (const dependency of record.imports) for (const group of boundaries.get(dependency) ?? []) {
        if (!targets.has(group)) { targets.add(group); changed = true }
      }
    }
  }
  const groups = Object.fromEntries(GROUPS.map(group => [group, { complete: false, assets: [] }]))
  const unique = new Map()
  const staticRoot = await realpath(path.join(next, "static"))
  for (const group of GROUPS) {
    const visited = new Set()
    const assets = new Map()
    const rootChunks = new Set([...roots.get(group)].flatMap(id => graph.records.get(id).map(record => record.url)))
    const compatible = url => (graph.chunks.get(url) ?? []).every(entry => [...entry.groups].every(other => other === group || other === "monitor"))
    function add(url, id) {
      if (assets.has(url)) { assets.get(url).add(`turbopack:${id}`); return }
      assets.set(url, new Set([`turbopack:${id}`]))
      for (const entry of graph.chunks.get(url) ?? []) for (const other of entry.groups) {
        if (other !== group && other !== "monitor") throw new Error(`Wallet feature groups share an inseparable chunk: ${group} requires ${other} in ${url} through module ${id}`)
      }
      for (const entry of graph.chunks.get(url) ?? []) if (!entry.ids.length) {
        for (const dependency of entry.assets) add(dependency, id)
        for (const dependency of entry.imports) visit(dependency, true)
      }
    }
    function visitLazy(id, worker) {
      const key = `lazy:${worker}:${id}`
      if (visited.has(key)) return
      visited.add(key)
      const records = graph.records.get(id)
      if (!records?.length) throw new Error(`Missing lazy loader ${id}`)
      for (const record of records) {
        if (!record.loaderTargets.size) throw new Error(`Unsupported lazy loader ${id}`)
        const targets = [...record.loaderTargets].filter(target => !boundaries.get(target)?.size || (boundaries.get(target).size === 1 && boundaries.get(target).has(group)))
        if (!targets.length) continue
        if (targets.length !== record.loaderTargets.size) throw new Error("Mixed wallet loader groups")
        if (worker || !eager.has(record.url)) add(record.url, id)
        for (const url of record.assets) if (worker || !eager.has(url)) add(url, id)
        for (const target of targets) visit(target, worker, true)
      }
    }
    function visit(id, worker = false, deferred = false) {
      const key = `${worker}:${id}`
      if (visited.has(key)) return
      if (boundaries.get(id)?.size && (boundaries.get(id).size !== 1 || !boundaries.get(id).has(group))) {
        if (!deferred) throw new Error("Wallet groups are statically coupled")
        return
      }
      visited.add(key)
      const records = graph.records.get(id)
      if (!records) throw new Error(`Missing emitted module ${id}`)
      if (!worker && records.some(record => eager.has(record.url))) return
      const candidates = records.filter(record => compatible(record.url))
      if (!candidates.length) throw new Error(`Wallet module ${id} has no isolated artifact for ${group}`)
      const preferred = candidates.filter(record => rootChunks.has(record.url) || assets.has(record.url))
      for (const record of preferred.length ? preferred : candidates) {
        if (record.unresolved) throw new Error(`Nonliteral dependency in required wallet module ${id}`)
        add(record.url, id)
        for (const url of record.assets) if (worker || !eager.has(url)) add(url, id)
        for (const dependency of record.imports) visit(dependency, worker)
        for (const dependency of record.deferred) visit(dependency, worker, true)
        for (const dependency of record.lazy) visitLazy(dependency, worker)
      }
    }
    for (const id of roots.get(group)) visit(id, graph.records.get(id).some(record => record.worker))
    for (const [id, records] of graph.records) if (records.some(record => [...record.loaderTargets].some(target => boundaries.get(target)?.size === 1 && boundaries.get(target).has(group)))) visitLazy(id, false)
    for (const [url, evidence] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
      if (!ASSET_URL.test(url)) throw new Error("Unsafe asset path")
      const filename = path.join(next, url.slice("/_next/".length))
      const resolved = await realpath(filename)
      const stat = await lstat(filename)
      if (!resolved.startsWith(`${staticRoot}${path.sep}`) || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_ASSET_BYTES) throw new Error("Unsafe static artifact")
      const bytes = await readFile(filename)
      if (bytes.length !== stat.size) throw new Error("Static artifact changed during generation")
      const extension = path.extname(filename)
      if (extension === ".wasm" && !WebAssembly.validate(bytes)) throw new Error("Invalid WASM artifact")
      if (extension === ".css" && /url\s*\(|@import/i.test(bytes.toString("utf8"))) throw new Error("CSS asset dependencies require explicit graph discovery")
      const mime = { ".js": "application/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" }[extension]
      const asset = { url, sha256: digest(bytes), bytes: bytes.length, mime, sharedWithApp: eager.has(url), modules: [...evidence].sort().slice(0, 64) }
      unique.set(url, asset.bytes)
      groups[group].assets.push(asset)
    }
    groups[group].complete = roots.get(group).size > 0
  }
  if (unique.size > 64 || [...unique.values()].reduce((sum, size) => sum + size, 0) > MAX_TOTAL_BYTES) throw new Error("Wallet artifact budget exceeded")
  const payload = { schema: 2, discovery: "turbopack-module-graph", buildId, groups }
  const manifest = { ...payload, version: digest(JSON.stringify(payload)) }
  if (Buffer.byteLength(JSON.stringify(manifest)) + 1 > 65536) throw new Error("Wallet manifest size limit exceeded")
  return manifest
}

export async function buildWalletAssetManifest(root = process.cwd()) {
  const next = path.join(root, ".next")
  const buildId = (await readFile(path.join(next, "BUILD_ID"), "utf8")).trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId)) throw new Error("Missing production build identity")
  await lstat(path.join(next, "turbopack"))
  const ownership = new Map()
  const evidence = new Map(GROUPS.map((group) => [group, new Map()]))
  for (const filename of await manifestFiles(path.join(next, "server", "app"))) {
    const modules = parseClientReferenceManifest(await readFile(filename, "utf8"))
    for (const [moduleId, record] of Object.entries(modules)) {
      if (!Array.isArray(record.chunks) || record.chunks.some((chunk) => typeof chunk !== "string")) {
        throw new Error("Unsupported client module chunks")
      }
      const group = walletModuleGroup(moduleId)
      for (const url of record.chunks) {
        if (!ownership.has(url)) ownership.set(url, new Set())
        ownership.get(url).add(group)
        if (group && ASSET_URL.test(url)) {
          const entries = evidence.get(group)
          if (!entries.has(url)) entries.set(url, new Set())
          entries.get(url).add(moduleId)
        }
      }
    }
  }
  const graph = await emittedGraph(next)
  if (graph.records.size) {
    const eager = new Set([...ownership].filter(([, owners]) => owners.has(null)).map(([url]) => url))
    const framework = JSON.parse(await readFile(path.join(next, "build-manifest.json"), "utf8"))
    if (!Array.isArray(framework.rootMainFiles) || !Array.isArray(framework.polyfillFiles)) throw new Error("Missing framework entry artifacts")
    for (const file of [...framework.rootMainFiles, ...framework.polyfillFiles]) {
      const url = `/_next/${file}`
      if (typeof file !== "string" || !ASSET_URL.test(url)) throw new Error("Unsupported framework entry artifact")
      eager.add(url)
    }
    return completeManifest(next, buildId, graph, eager)
  }
  const groups = Object.fromEntries(GROUPS.map((group) => [group, { complete: false, assets: [] }]))
  let totalBytes = 0
  let count = 0
  const staticRoot = await realpath(path.join(next, "static"))
  for (const group of GROUPS) {
    for (const [url, modules] of [...evidence.get(group)].sort(([a], [b]) => a.localeCompare(b))) {
      const owners = ownership.get(url)
      if (owners.has(null) || owners.size !== 1) continue
      const filename = path.join(next, url.slice("/_next/".length))
      const resolved = await realpath(filename)
      const stat = await lstat(filename)
      if (!resolved.startsWith(`${staticRoot}${path.sep}`) || !stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Unsafe static artifact")
      }
      if (stat.size <= 0 || stat.size > MAX_ASSET_BYTES) throw new Error("Static artifact size limit exceeded")
      const bytes = await readFile(filename)
      if (bytes.length !== stat.size) throw new Error("Static artifact changed during generation")
      totalBytes += bytes.length
      count += 1
      if (totalBytes > MAX_TOTAL_BYTES || count > 64) throw new Error("Wallet artifact budget exceeded")
      if (modules.size > 64 || [...modules].some((moduleId) => moduleId.length > 512)) throw new Error("Wallet graph evidence budget exceeded")
      groups[group].assets.push({ url, sha256: digest(bytes), bytes: bytes.length, mime: "application/javascript", modules: [...modules].sort() })
    }
  }
  if (!count) throw new Error("No exclusive wallet client-reference artifacts found; Next code-split asset discovery remains unfinished")
  const payload = { schema: 1, discovery: "partial-client-reference-graph", buildId, groups }
  const manifest = { ...payload, version: digest(JSON.stringify(payload)) }
  if (Buffer.byteLength(JSON.stringify(manifest)) + 1 > 65536) throw new Error("Wallet manifest size limit exceeded")
  return manifest
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/build-wallet-asset-manifest.mjs [--check]")
  const manifest = await buildWalletAssetManifest()
  if (manifest.schema !== 2) throw new Error("Production requires the complete emitted module graph")
  if (!process.argv.includes("--check")) {
    const output = path.resolve("public/wallet-asset-manifest.json")
    const temporary = `${output}.tmp`
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, { flag: "wx" })
    await rename(temporary, output)
  }
  process.stderr.write(`${JSON.stringify({ discovery: manifest.discovery, groups: Object.fromEntries(Object.entries(manifest.groups).map(([group, entry]) => [group, { complete: entry.complete, assets: entry.assets.length, bytes: entry.assets.reduce((sum, asset) => sum + asset.bytes, 0) }])) })}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Wallet manifest generation failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
