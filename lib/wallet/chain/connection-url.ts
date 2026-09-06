"use client"

export type IndexerConnection = Readonly<{
  kind: "esplora" | "electrum"
  transport: "https" | "wss" | "tcp" | "tls" | "ssl"
  url: string
  hostname: string
  port: number
  browserSupport: "direct" | "requires-user-owned-bridge"
}>

export class ConnectionUrlError extends Error {
  constructor() {
    super("Use an explicit HTTPS explorer or WSS indexer URL without credentials, query, or fragment.")
    this.name = "ConnectionUrlError"
  }
}

export function parseConnectionUrl(input: string): IndexerConnection {
  const invalid = () => { throw new ConnectionUrlError() }
  if (typeof input !== "string" || input.length > 2048 || /[\s\\?#]/.test(input)) return invalid()
  const match = /^(https|wss|tcp|tls|ssl):\/\/([^/]+)(\/.*)?$/.exec(input)
  if (!match || /[@%]/.test(match[2])) return invalid()
  const transport = match[1] as IndexerConnection["transport"]
  const authority = match[2]
  const authorityMatch = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(authority)
  if (!authorityMatch) return invalid()
  const explicitPort = authorityMatch[2]
  if (explicitPort && (!Number.isSafeInteger(Number(explicitPort)) || Number(explicitPort) < 1 || Number(explicitPort) > 65535)) return invalid()
  const direct = transport === "https" || transport === "wss"
  if (!direct && (!explicitPort || (match[3] && match[3] !== "/"))) return invalid()
  let parsed: URL
  try {
    parsed = new URL(`https://${authority}${match[3] ?? "/"}`)
  } catch {
    return invalid()
  }
  const hostname = parsed.hostname.toLowerCase()
  const rawHost = authorityMatch[1].toLowerCase()
  if ((!rawHost.startsWith("[") && hostname !== rawHost) || hostname.endsWith(".") || hostname.length > 253) return invalid()
  if (!hostname.startsWith("[") && hostname.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label) || label.length > 63)) return invalid()
  if (hostname === "0.0.0.0" || hostname.startsWith("169.254.") || hostname === "[::]" || /^\[fe[89ab]/.test(hostname) || hostname.startsWith("[ff") || hostname.includes("::ffff:") || hostname === "metadata.google.internal") return invalid()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && Number(hostname.split(".")[0]) >= 224) return invalid()
  const rawPath = match[3] ?? "/"
  if (/%|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath) || !/^\/[a-zA-Z0-9._~/-]*$/.test(rawPath)) return invalid()
  const path = transport === "https" ? parsed.pathname.replace(/\/+$/, "") : direct ? parsed.pathname : ""
  const port = explicitPort ? Number(explicitPort) : 443
  const hostPort = explicitPort && (port !== 443 || !direct) ? `${hostname}:${port}` : hostname
  return Object.freeze({
    kind: transport === "https" ? "esplora" : "electrum",
    transport,
    url: `${transport}://${hostPort}${path}`,
    hostname,
    port,
    browserSupport: direct ? "direct" : "requires-user-owned-bridge",
  })
}
