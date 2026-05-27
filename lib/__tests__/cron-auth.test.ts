// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"
import { cronAuthFailureResponse } from "@/lib/cron-auth"

describe("cronAuthFailureResponse", () => {
  const originalSecret = process.env.CRON_SECRET

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalSecret
    }
  })

  it("rejects when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET
    const res = cronAuthFailureResponse("Bearer anything")
    expect(res?.status).toBe(401)
  })

  it("rejects when CRON_SECRET is empty", () => {
    process.env.CRON_SECRET = ""
    const res = cronAuthFailureResponse("Bearer ")
    expect(res?.status).toBe(401)
  })

  it("rejects Bearer undefined when secret is unset", () => {
    delete process.env.CRON_SECRET
    const res = cronAuthFailureResponse("Bearer undefined")
    expect(res?.status).toBe(401)
  })

  it("accepts a matching bearer token", () => {
    process.env.CRON_SECRET = "test-secret"
    expect(cronAuthFailureResponse("Bearer test-secret")).toBeNull()
  })

  it("rejects a wrong bearer token", () => {
    process.env.CRON_SECRET = "test-secret"
    const res = cronAuthFailureResponse("Bearer wrong")
    expect(res?.status).toBe(401)
  })

  it("rejects when no Authorization header is sent (null)", () => {
    process.env.CRON_SECRET = "test-secret"
    const res = cronAuthFailureResponse(null)
    expect(res?.status).toBe(401)
  })

  it("rejects a whitespace-only CRON_SECRET", () => {
    process.env.CRON_SECRET = "   "
    const res = cronAuthFailureResponse("Bearer    ")
    expect(res?.status).toBe(401)
  })
})
