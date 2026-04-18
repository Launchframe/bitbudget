import { describe, expect, it } from "vitest"
import { bitbudgetRefCookieOptions } from "../referral-cookie"

describe("bitbudgetRefCookieOptions", () => {
  it("sets secure for https URLs", () => {
    const req = new Request("https://bitbudget.example/ref/ABC")
    expect(bitbudgetRefCookieOptions(req).secure).toBe(true)
  })

  it("clears secure for http URLs (local dev)", () => {
    const req = new Request("http://127.0.0.1:3000/ref/ABC")
    expect(bitbudgetRefCookieOptions(req).secure).toBe(false)
  })
})
