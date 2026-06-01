import { describe, expect, it, vi } from "vitest"

import { EsploraClient, normalizeExplorerBaseUrl } from "@/lib/wallets/esplora-client"

describe("normalizeExplorerBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeExplorerBaseUrl("https://mempool.space///")).toBe("https://mempool.space")
  })

  it("strips a trailing /api segment", () => {
    expect(normalizeExplorerBaseUrl("https://blockstream.info/api")).toBe("https://blockstream.info")
  })

  it("leaves base URLs without /api unchanged", () => {
    expect(normalizeExplorerBaseUrl("https://mempool.space")).toBe("https://mempool.space")
  })
})

describe("EsploraClient", () => {
  it("does not double /api when baseUrl already includes /api", async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.endsWith("/api/blocks/tip/height")) {
        return { ok: true, status: 200, text: async () => "800000", json: async () => 800000 }
      }
      throw new Error(`unexpected url ${url}`)
    })

    const client = new EsploraClient({
      baseUrl: "https://blockstream.info/api",
      fetchImpl,
      minRequestSpacingMs: 0,
    })

    await client.getTipHeight()
    expect(seen).toEqual(["https://blockstream.info/api/blocks/tip/height"])
    expect(client.baseUrl).toBe("https://blockstream.info")
  })
})
