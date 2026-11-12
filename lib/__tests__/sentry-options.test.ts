// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"
import { baseSentryOptions } from "../sentry-options"

describe("baseSentryOptions", () => {
  afterEach(() => {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
  })

  it("uses the public DSN when configured for browser bundles", () => {
    process.env.SENTRY_DSN = "https://server@example.ingest.sentry.io/1"
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/1"

    const options = baseSentryOptions()

    expect(options.dsn).toBe("https://public@example.ingest.sentry.io/1")
    expect(options.enabled).toBe(true)
  })

  it("falls back to the private DSN for server-only configuration", () => {
    process.env.SENTRY_DSN = "https://server@example.ingest.sentry.io/1"

    const options = baseSentryOptions()

    expect(options.dsn).toBe("https://server@example.ingest.sentry.io/1")
    expect(options.enabled).toBe(true)
  })
})
