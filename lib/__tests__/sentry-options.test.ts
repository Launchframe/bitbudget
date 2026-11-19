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

  it("scrubs a bitcoin address from error events and spans", () => {
    const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    const url = `https://mempool.space/api/address/${address}`
    const options = baseSentryOptions()
    const event = options.beforeSend?.(
      {
        breadcrumbs: [{ data: { url } }],
      } as unknown as Parameters<NonNullable<typeof options.beforeSend>>[0],
      {},
    )
    expect(JSON.stringify(event)).not.toContain(address)

    const span = options.beforeSendSpan?.({
      data: { "http.url": url },
      description: `GET ${url}`,
      span_id: "span",
      start_timestamp: 0,
      trace_id: "trace",
    })
    expect(JSON.stringify(span)).not.toContain(address)
    expect(span?.description).toContain("[redacted-address]")
  })
})
