import { afterEach, describe, expect, it, vi } from "vitest"
import { walletRequest } from "@/lib/wallet/client-http"

afterEach(() => vi.unstubAllGlobals())

describe("wallet HTTP in blob workers", () => {
  it("resolves API requests against the origin, not the blob worker URL", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.test", href: "blob:https://app.example.test/worker-id" })
    const fetch = vi.fn(async () => new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } }))
    vi.stubGlobal("fetch", fetch)
    expect(await walletRequest("/api/wallets", { network: "regtest" })).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith("https://app.example.test/api/wallets", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" }))
  })

  it("does not forward credentials to arbitrary URLs", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    for (const target of ["https://evil.test/api/wallets", "//evil.test", "/api/wallets/../auth", "/api/wallets?url=other"]) {
      await expect(walletRequest(target)).rejects.toThrow("invalid-wallet-request")
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it("reports only a bounded error code, not raw service content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":"credential-rejected","private":"do not show"}}', { status: 403, headers: { "Content-Type": "application/json" } })))
    await expect(walletRequest("/api/wallets")).rejects.toThrow("credential-rejected")
  })
})
