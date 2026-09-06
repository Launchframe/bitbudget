import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const GROUPS = ["monitor", "signer", "blake2b", "advanced"]
const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const ASSET_URL = /^\/_next\/static\/chunks\/[a-f0-9]{16,64}\.js$/
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
  if (!process.argv.includes("--check")) {
    const output = path.resolve("public/wallet-asset-manifest.json")
    const temporary = `${output}.tmp`
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, { flag: "wx" })
    await rename(temporary, output)
  }
  process.stderr.write("Verified partial wallet artifacts only; transitive/dynamic Next code-split discovery remains unfinished.\n")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Wallet manifest generation failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
