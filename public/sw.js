// Network-only fetch handler — required for installability; no offline cache for this auth-heavy app.
const WALLET_MANIFEST_URL = new URL("/wallet-asset-manifest.json", self.location.origin).href
const WALLET_CACHE_PREFIX = "bitbudget-wallet-assets-v1-"
const WALLET_GROUPS = ["monitor", "signer", "blake2b", "advanced"]
const WALLET_ASSET_URL = /^\/_next\/static\/(?:chunks\/(?:turbopack-)?[a-f0-9]{16,64}\.(?:js|css)|media\/[a-zA-Z0-9_-]+\.[a-f0-9]{8,64}\.(?:wasm|woff2|svg|png|webp))$/
const WALLET_MAX_ASSET_BYTES = 4 * 1024 * 1024
const WALLET_MAX_TOTAL_BYTES = 16 * 1024 * 1024
const walletManifests = new Map()
let walletMessageQueue = Promise.resolve()
const walletGrants = new Map()

async function walletReadBytes(response, limit) {
  const declared = response.headers.get("content-length")
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    void response.body?.cancel().catch(() => {})
    throw new Error("size")
  }
  if (!response.body) throw new Error("body")
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error("size")
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function walletSha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function walletPublicResponse(response, url, mime) {
  return response.status === 200 && response.type === "basic" && !response.redirected && response.url === url &&
    mime.includes((response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()) &&
    !response.headers.has("content-range") && !response.headers.has("set-cookie") &&
    !/(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(response.headers.get("cache-control") || "") &&
    !(response.headers.get("vary") || "").split(",").some((value) => /^(?:\*|cookie|authorization|rsc|next-router-state-tree|next-router-prefetch)$/i.test(value.trim()))
}

async function walletVerifyAsset(response, asset) {
  try {
    const url = new URL(asset.url, self.location.origin).href
    const mime = asset.mime === "application/javascript" ? ["application/javascript", "text/javascript"] : [asset.mime]
    if (!walletPublicResponse(response, url, mime) ||
      !/(?:^|,)\s*immutable\s*(?:,|$)/i.test(response.headers.get("cache-control") || "")) throw new Error("response")
    const bytes = await walletReadBytes(response.clone(), asset.bytes)
    if (bytes.length !== asset.bytes || await walletSha256(bytes) !== asset.sha256) throw new Error("integrity")
  } catch (error) {
    void response.body?.cancel().catch(() => {})
    throw error
  }
}

async function walletLoadManifest(signal) {
  const response = await fetch(WALLET_MANIFEST_URL, { credentials: "omit", cache: "no-store", redirect: "error", mode: "same-origin", signal })
  if (response.status !== 200 || response.type !== "basic" || response.redirected || response.url !== WALLET_MANIFEST_URL ||
    response.headers.has("set-cookie") || (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("manifest")
  const manifest = JSON.parse(new TextDecoder().decode(await walletReadBytes(response, 65536)))
  const complete = manifest.schema === 2 && manifest.discovery === "turbopack-module-graph"
  if ((!complete && (manifest.schema !== 1 || manifest.discovery !== "partial-client-reference-graph")) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.buildId) || !/^[a-f0-9]{64}$/.test(manifest.version) ||
    !manifest.groups || Object.keys(manifest.groups).sort().join(",") !== [...WALLET_GROUPS].sort().join(",")) throw new Error("manifest")
  const urls = new Map()
  let total = 0
  for (const group of WALLET_GROUPS) {
    const entry = manifest.groups[group]
    if (!entry || typeof entry.complete !== "boolean" || (!complete && entry.complete) || !Array.isArray(entry.assets) ||
      (complete && entry.complete !== (entry.assets.length > 0))) throw new Error("group")
    const seen = new Set()
    for (const asset of entry.assets) {
      if (!asset || typeof asset.url !== "string" || !WALLET_ASSET_URL.test(asset.url) || seen.has(asset.url) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > WALLET_MAX_ASSET_BYTES ||
        asset.mime !== ({ js: "application/javascript", css: "text/css", wasm: "application/wasm", woff2: "font/woff2", svg: "image/svg+xml", png: "image/png", webp: "image/webp" })[asset.url.split(".").at(-1)] ||
        !Array.isArray(asset.modules) || asset.modules.length === 0 || asset.modules.length > 64 ||
        asset.modules.some((moduleId) => typeof moduleId !== "string" || moduleId.length > 512 || (complete ? !/^turbopack:\d{1,16}$/.test(moduleId) :
          !new RegExp(`^\\[project\\]/lib/wallet/${group}(?:/[^<>]+|(?:-entry)?\\.[cm]?[jt]sx?)(?: <module evaluation>)?$`).test(moduleId)))) throw new Error("asset")
      const previous = urls.get(asset.url)
      if (previous && (!complete || previous.sha256 !== asset.sha256 || previous.bytes !== asset.bytes || previous.mime !== asset.mime)) throw new Error("duplicate")
      seen.add(asset.url)
      if (!previous) total += asset.bytes
      urls.set(asset.url, asset)
    }
  }
  if (!urls.size || urls.size > 64 || total > WALLET_MAX_TOTAL_BYTES) throw new Error("budget")
  const { schema, discovery, buildId, groups } = manifest
  if (await walletSha256(new TextEncoder().encode(JSON.stringify({ schema, discovery, buildId, groups }))) !== manifest.version) throw new Error("version")
  return manifest
}

async function walletHandleMessage(event) {
  const data = event.data
  if (!data || data.type !== "wallet-assets-cache" || Object.keys(data).sort().join(",") !== "group,reason,type" ||
    !WALLET_GROUPS.includes(data.group) || !["opt-in", "demand"].includes(data.reason) ||
    event.origin !== self.location.origin || !event.source?.id || event.ports.length !== 1) return
  const controlled = await self.clients.matchAll({ type: "window", includeUncontrolled: false })
  const client = controlled.find((candidate) => candidate.id === event.source.id)
  if (!client || new URL(client.url).origin !== self.location.origin) return
  for (const id of walletGrants.keys()) if (!controlled.some((candidate) => candidate.id === id)) walletGrants.delete(id)
  try {
    const signal = AbortSignal.timeout(45000)
    const manifest = await walletLoadManifest(signal)
    const assets = manifest.groups[data.group].assets
    if (!assets.length || (!walletGrants.has(client.id) && walletGrants.size >= 128)) throw new Error("unavailable")
    const referenced = new Set([...walletGrants.values()].flatMap(groups => [...groups.values()]))
    if (!referenced.has(manifest.version) && referenced.size >= 4) throw new Error("versions")
    const name = WALLET_CACHE_PREFIX + manifest.version
    const pending = []
    const existingNames = await caches.keys()
    const existing = existingNames.includes(name) ? await caches.open(name) : null
    for (const asset of assets) {
      const url = new URL(asset.url, self.location.origin).href
      let response = await existing?.match(url)
      if (response) {
        try {
          await walletVerifyAsset(response, asset)
          continue
        } catch {
          await existing.delete(url)
          response = null
        }
      }
      response = await fetch(url, { credentials: "omit", cache: "no-store", redirect: "error", mode: "same-origin", signal })
      await walletVerifyAsset(response, asset)
      pending.push([url, response])
    }
    const cache = await caches.open(name)
    const written = []
    try {
      for (const [url, response] of pending) {
        await cache.put(url, response)
        written.push(url)
      }
    } catch (error) {
      for (const url of written) await cache.delete(url)
      if (!existing) await caches.delete(name)
      throw error
    }
    walletManifests.set(manifest.version, manifest)
    if (!walletGrants.has(client.id)) walletGrants.set(client.id, new Map())
    walletGrants.get(client.id).set(data.group, manifest.version)
    const active = new Set([...walletGrants.values()].flatMap(groups => [...groups.values()]))
    for (const oldName of await caches.keys()) {
      if (/^bitbudget-wallet-assets-v1-[a-f0-9]{64}$/.test(oldName) && !active.has(oldName.slice(WALLET_CACHE_PREFIX.length))) await caches.delete(oldName)
    }
    for (const version of walletManifests.keys()) if (!active.has(version)) walletManifests.delete(version)
    event.ports[0].postMessage({ status: manifest.groups[data.group].complete ? "cached" : "partial", group: data.group, cachedAssets: assets.length })
  } catch {
    event.ports[0].postMessage({ status: "unavailable", group: data.group, cachedAssets: 0 })
  }
}

self.addEventListener("message", (event) => {
  walletMessageQueue = walletMessageQueue.then(() => walletHandleMessage(event)).catch(() => {})
  event.waitUntil(walletMessageQueue)
})

async function walletFetch(event) {
  const request = event.request
  if (request.method !== "GET" || !["", "script", "style", "font", "image", "worker", "sharedworker"].includes(request.destination) ||
    request.mode === "navigate" || ["authorization", "range", "rsc", "next-router-state-tree", "next-router-prefetch"].some(name => request.headers.has(name)) ||
    /text\/html|text\/x-component/i.test(request.headers.get("accept") || "") || !WALLET_ASSET_URL.test(new URL(request.url).pathname)) return fetch(request)
  let grants = walletGrants.get(event.clientId)
  if (!grants && walletGrants.size && self.clients.get) {
    try {
      const client = await self.clients.get(event.clientId)
      if (client && ["worker", "sharedworker"].includes(client.type) && new URL(client.url).origin === self.location.origin) {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: false })
        grants = [...walletGrants].filter(([id]) => windows.some(window => window.id === id)).flatMap(([, groups]) => [...groups])
      }
    } catch {}
  }
  for (const [group, version] of grants ?? []) {
    const manifest = walletManifests.get(version)
    const asset = manifest?.groups[group].assets.find(candidate => new URL(candidate.url, self.location.origin).href === request.url)
    if (!asset) continue
    try {
      const name = WALLET_CACHE_PREFIX + version
      if (!(await caches.keys()).includes(name)) continue
      const cache = await caches.open(name)
      const response = await cache.match(request.url)
      if (response) {
        try {
          await walletVerifyAsset(response, asset)
          return response
        } catch {
          await cache.delete(request.url)
        }
      }
    } catch {}
  }
  return fetch(request)
}

self.addEventListener("fetch", (event) => {
  event.respondWith(walletFetch(event))
})

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || "bitbudget"
  const options = {
    body: data.body || "Time to log your spending!",
    icon: "/icon-vanilla.svg",
    badge: "/icon-vanilla.svg",
    data: { url: data.url || "/" },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"
  event.waitUntil(clients.openWindow(url))
})
