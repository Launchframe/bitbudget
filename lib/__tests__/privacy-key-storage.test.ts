import { describe, expect, it } from "vitest"
import { PRIVACY_KEY_CACHE_TTL_MS } from "@/lib/privacy-key-storage"

describe("privacy key storage policy", () => {
  it("uses a 7-day TTL", () => {
    expect(PRIVACY_KEY_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
