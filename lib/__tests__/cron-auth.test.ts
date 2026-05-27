import { afterEach, describe, expect, it } from "vitest"
import { isCronRequestAuthorized } from "@/lib/cron-auth"

function req(auth: string | null): { headers: Headers } {
  const headers = new Headers()
  if (auth != null) headers.set("authorization", auth)
  return { headers }
}

describe("isCronRequestAuthorized", () => {
  const original = process.env.CRON_SECRET

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })

  it("rejects when CRON_SECRET is unset (no Bearer undefined bypass)", () => {
    delete process.env.CRON_SECRET
    expect(isCronRequestAuthorized(req("Bearer undefined"))).toBe(false)
    expect(isCronRequestAuthorized(req(null))).toBe(false)
  })

  it("rejects when CRON_SECRET is empty", () => {
    process.env.CRON_SECRET = ""
    expect(isCronRequestAuthorized(req("Bearer "))).toBe(false)
    expect(isCronRequestAuthorized(req("Bearer undefined"))).toBe(false)
  })

  it("accepts a timing-safe match for the configured secret", () => {
    process.env.CRON_SECRET = "test-cron-secret"
    expect(isCronRequestAuthorized(req("Bearer test-cron-secret"))).toBe(true)
    expect(isCronRequestAuthorized(req("Bearer wrong"))).toBe(false)
    expect(isCronRequestAuthorized(req("Bearer test-cron-secre"))).toBe(false)
  })
})
