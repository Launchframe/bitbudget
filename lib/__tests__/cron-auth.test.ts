import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { unauthorizedCronResponse } from "../cron-auth"

describe("unauthorizedCronResponse", () => {
  const prev = process.env.CRON_SECRET

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })

  beforeEach(() => {
    delete process.env.CRON_SECRET
  })

  it("rejects when CRON_SECRET is unset (blocks Bearer undefined bypass)", () => {
    const req = new Request("http://localhost/api/cron/recurring", {
      headers: { authorization: "Bearer undefined" },
    })
    const res = unauthorizedCronResponse(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  it("rejects when CRON_SECRET is empty", () => {
    process.env.CRON_SECRET = ""
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer " },
    })
    expect(unauthorizedCronResponse(req)?.status).toBe(401)
  })

  it("rejects wrong bearer token", () => {
    process.env.CRON_SECRET = "test-secret"
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer wrong" },
    })
    expect(unauthorizedCronResponse(req)?.status).toBe(401)
  })

  it("allows matching bearer token", () => {
    process.env.CRON_SECRET = "test-secret"
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer test-secret" },
    })
    expect(unauthorizedCronResponse(req)).toBeNull()
  })
})
