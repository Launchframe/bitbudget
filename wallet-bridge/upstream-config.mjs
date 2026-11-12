import { isIP } from "node:net"

export function parseElectrumTls(value) {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\\?#@]/.test(value)) throw new Error("Invalid ELECTRUM_TLS setting")
  const url = new URL(value.includes("://") ? value : `tls://${value}`)
  if (!["ssl:", "tls:"].includes(url.protocol) || !url.hostname || !url.port || (url.pathname && url.pathname !== "/") || url.username || url.password) throw new Error("Expected an explicit Electrum TLS endpoint")
  const port = Number(url.port)
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Electrum TLS port")
  if (host.endsWith(".onion") && !/^[a-z2-7]{56}\.onion$/.test(host)) throw new Error("A valid v3 onion hostname is required")
  return { host, port }
}

export function parseSocksProxy(value) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || /[\s\\?#@]/.test(value)) throw new Error("Invalid SOCKS proxy")
  const url = new URL(value)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const port = Number(url.port)
  if (url.protocol !== "socks5h:" || !isIP(host) || !url.port || !Number.isInteger(port) || port < 1 || port > 65535 || (url.pathname && url.pathname !== "/") || url.username || url.password) throw new Error("Use socks5h with an explicit proxy IP and port")
  return { host, port }
}
