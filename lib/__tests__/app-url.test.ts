import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveEmailAppUrl } from "@/lib/app-url"

const env = process.env

afterEach(() => {
  process.env = { ...env }
  vi.unstubAllEnvs()
})

describe("resolveEmailAppUrl", () => {
  it("prefers NEXTAUTH_URL when set", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com/")
    vi.stubEnv("VERCEL_URL", "preview.vercel.app")
    expect(resolveEmailAppUrl()).toBe("https://app.example.com")
  })

  it("uses VERCEL_URL on preview when NEXTAUTH_URL is unset", () => {
    vi.stubEnv("NEXTAUTH_URL", "")
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "bitbudget.io")
    vi.stubEnv("VERCEL_URL", "bitbudget-git-branch.vercel.app")
    expect(resolveEmailAppUrl()).toBe("https://bitbudget-git-branch.vercel.app")
  })

  it("uses production host only when VERCEL_ENV is production", () => {
    vi.stubEnv("NEXTAUTH_URL", "")
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "bitbudget.io")
    vi.stubEnv("VERCEL_URL", "bitbudget-git-branch.vercel.app")
    expect(resolveEmailAppUrl()).toBe("https://bitbudget.io")
  })
})
