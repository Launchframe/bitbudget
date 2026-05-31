import { afterEach, describe, expect, it, vi } from "vitest"
import { parseBankAlertText } from "@/lib/bank-alert-parser"

describe("parseBankAlertText rate limits", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  it("rethrows OpenAI 429 instead of returning null", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "rate limit" } }),
      }),
    )

    vi.resetModules()
    const { parseBankAlertText: parseFresh } = await import("@/lib/bank-alert-parser")
    await expect(parseFresh("Debit $1 at Store")).rejects.toThrow(/429/)
  })
})
