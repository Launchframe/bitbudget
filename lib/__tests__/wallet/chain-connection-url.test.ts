import { describe, expect, it } from "vitest"

import { ConnectionUrlError, parseConnectionUrl } from "@/lib/wallet/chain/connection-url"

describe("browser indexer connection URLs", () => {
  it("accepts explicit HTTPS and WSS including IPv6 and bounded ports", () => {
    expect(parseConnectionUrl("https://indexer.example/api/")).toMatchObject({ kind: "esplora", url: "https://indexer.example/api", port: 443, browserSupport: "direct" })
    expect(parseConnectionUrl("wss://[2001:db8::1]:65535/electrum")).toMatchObject({ kind: "electrum", hostname: "[2001:db8::1]", port: 65535, browserSupport: "direct" })
    expect(parseConnectionUrl("https://[2001:0db8:0000:0000:0000:0000:0000:0001]:1").url).toBe("https://[2001:db8::1]:1")
    expect(parseConnectionUrl("wss://localhost:50004").url).toBe("wss://localhost:50004/")
  })

  it.each(["tcp", "tls", "ssl"])("recognizes %s as requiring a user-owned bridge", scheme => {
    expect(parseConnectionUrl(`${scheme}://[::1]:50002`)).toMatchObject({ kind: "electrum", transport: scheme, browserSupport: "requires-user-owned-bridge", port: 50002 })
  })

  it.each([
    "indexer.example:50002", "//indexer.example", "http://indexer.example", "ws://indexer.example", "file:///etc/passwd",
    "javascript:alert(1)", "gopher://127.0.0.1:70", "https:///indexer.example", "https://indexer.example:0",
    "wss://indexer.example:65536", "https://indexer.example:-1", "https://indexer.example:1.5", "https://indexer.example:",
    "https://user:password@indexer.example", "wss://user@indexer.example", "https://@indexer.example", "https://user%40indexer.example",
    "https://indexer.example#", "https://indexer.example/#fragment", "https://indexer.example?token=secret", "https://indexer.example?",
    " https://indexer.example", "https://indexer.example\n", "https://indexer.example\\@evil.example",
    "https://169.254.169.254/latest/meta-data", "https://metadata.google.internal", "https://2130706433", "https://0x7f000001", "https://127.1",
    "https://0177.0.0.1", "https://0.0.0.0", "https://[::]", "https://[fe80::1]", "https://[::ffff:169.254.169.254]",
    "https://indexer.example/api/../private", "https://indexer.example/api/%2e%2e/private", "https://indexer.example//evil.example",
    "https://indexer.example./api", "https://-bad.example", "https://2001:db8::1:443", "https://[gggg::1]", "tls://host.example", "tcp://host.example:50001/path",
  ])("rejects unsafe or ambiguous input %s without echoing input", input => {
    expect(() => parseConnectionUrl(input)).toThrow(ConnectionUrlError)
    try { parseConnectionUrl(input) } catch (error) {
      expect((error as Error).message).not.toContain(input)
      expect((error as Error).message).not.toContain("password")
    }
  })
})
