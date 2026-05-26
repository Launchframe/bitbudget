import { describe, expect, it, afterEach } from "vitest"
import { isE2eApiTokenValid, isE2eTestApiEnabled } from "@/lib/e2e-api-guard"

describe("isE2eTestApiEnabled", () => {
  const env = process.env

  afterEach(() => {
    process.env = env
  })

  it("is false when E2E_TEST is not true", () => {
    process.env = { ...env, E2E_TEST: "false", NODE_ENV: "test" }
    expect(isE2eTestApiEnabled()).toBe(false)
  })

  it("is false in production NODE_ENV even when E2E_TEST is true", () => {
    process.env = { ...env, E2E_TEST: "true", NODE_ENV: "production", VERCEL_ENV: undefined }
    expect(isE2eTestApiEnabled()).toBe(false)
  })

  it("is false when VERCEL_ENV is production", () => {
    process.env = { ...env, E2E_TEST: "true", NODE_ENV: "test", VERCEL_ENV: "production" }
    expect(isE2eTestApiEnabled()).toBe(false)
  })

  it("is true in test env with E2E_TEST", () => {
    process.env = { ...env, E2E_TEST: "true", NODE_ENV: "test", VERCEL_ENV: "preview" }
    expect(isE2eTestApiEnabled()).toBe(true)
  })
})

describe("isE2eApiTokenValid", () => {
  const env = process.env

  afterEach(() => {
    process.env = env
  })

  it("allows any request when E2E_API_TOKEN is unset", () => {
    process.env = { ...env, E2E_API_TOKEN: undefined }
    const req = new Request("http://localhost", { headers: {} })
    expect(isE2eApiTokenValid(req)).toBe(true)
  })

  it("requires matching x-e2e-api-token when E2E_API_TOKEN is set", () => {
    process.env = { ...env, E2E_API_TOKEN: "secret" }
    const ok = new Request("http://localhost", { headers: { "x-e2e-api-token": "secret" } })
    const bad = new Request("http://localhost", { headers: { "x-e2e-api-token": "wrong" } })
    expect(isE2eApiTokenValid(ok)).toBe(true)
    expect(isE2eApiTokenValid(bad)).toBe(false)
  })
})
