// @vitest-environment node
import { describe, it, expect } from "vitest"
import { scrubAlertText, scrubSentryEvent, scrubSentrySpan } from "../sentry-scrub"

describe("scrubAlertText", () => {
  it("redacts emails", () => {
    expect(scrubAlertText("failed for user@example.com")).toContain("[redacted-email]")
    expect(scrubAlertText("failed for user@example.com")).not.toContain("user@example.com")
  })

  it("redacts npub and nsec", () => {
    const npub = "npub1" + "a".repeat(58)
    expect(scrubAlertText(`key ${npub}`)).toContain("[redacted-npub]")
  })

  it("redacts sensitive key-value pairs in free text", () => {
    const scrubbed = scrubAlertText(
      'payload {"password":"hunter2","payee":"Coffee Shop","authorization":"Bearer abc123"} token=plain-secret',
    )
    expect(scrubbed).toContain('"password":[redacted]')
    expect(scrubbed).toContain('"payee":[redacted]')
    expect(scrubbed).toContain('"authorization":[redacted]')
    expect(scrubbed).toContain("token=[redacted]")
    expect(scrubbed).not.toContain("hunter2")
    expect(scrubbed).not.toContain("Coffee Shop")
    expect(scrubbed).not.toContain("abc123")
    expect(scrubbed).not.toContain("plain-secret")
  })

  it("redacts shopping invite tokens and aliases", () => {
    const scrubbed = scrubAlertText(
      'inviteToken=abc_secret_token alias="Sam" merchant="Whole Foods"',
    )
    expect(scrubbed).not.toContain("abc_secret_token")
    expect(scrubbed).not.toContain("Sam")
    expect(scrubbed).not.toContain("Whole Foods")
  })

  it("redacts standalone bearer tokens", () => {
    const scrubbed = scrubAlertText("request failed with Bearer abc.def-123")
    expect(scrubbed).toContain("Bearer [redacted]")
    expect(scrubbed).not.toContain("abc.def-123")
  })

  it("redacts bitcoin addresses", () => {
    const bech32 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    const base58 = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"
    const scrubbed = scrubAlertText(
      `lookup https://mempool.space/api/address/${bech32} and ${base58}`,
    )
    expect(scrubbed).toContain("[redacted-address]")
    expect(scrubbed).not.toContain(bech32)
    expect(scrubbed).not.toContain(base58)
    expect(scrubbed).toContain("mempool.space")
  })
})

describe("scrubSentryEvent", () => {
  it("redacts PII from top-level messages", () => {
    const event = scrubSentryEvent({
      message: "Failed to process user@example.com",
    })
    expect(event?.message).toContain("[redacted-email]")
    expect(event?.message).not.toContain("user@example.com")
  })

  it("strips user email and sensitive headers", () => {
    const event = scrubSentryEvent({
      user: { id: "u1", email: "secret@example.com" },
      request: {
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        cookies: { session: "abc" },
      },
      extra: { payee: "Coffee Shop", notes: "latte" },
    })
    expect(event?.user?.email).toBeUndefined()
    expect((event?.request?.headers as Record<string, string>).Authorization).toBe("[redacted]")
    expect((event?.extra as Record<string, unknown>).payee).toBe("[redacted]")
  })

  it("redacts PII from exception message values", () => {
    const event = scrubSentryEvent({
      exception: {
        values: [
          { type: "Error", value: "Failed to send to admin@example.com" },
          { type: "TypeError", value: "Cannot read property of null" },
        ],
      },
    })
    expect(event?.exception?.values?.[0].value).toContain("[redacted-email]")
    expect(event?.exception?.values?.[0].value).not.toContain("admin@example.com")
    expect(event?.exception?.values?.[1].value).toBe("Cannot read property of null")
  })

  it("redacts a bitcoin address from fetch breadcrumbs and spans", () => {
    const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    const url = `https://mempool.space/api/address/${address}`
    const event = scrubSentryEvent({
      breadcrumbs: [{ message: "fetch", data: { url, method: "GET" } }],
      spans: [{ description: `GET ${url}`, data: { "http.url": url } }],
      request: { url },
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain(address)
    expect(serialized).toContain("[redacted-address]")
    expect(event?.breadcrumbs?.[0]?.data?.method).toBe("GET")
  })
})

describe("scrubSentrySpan", () => {
  it("redacts the fetch URL and leaves the span in place", () => {
    const address = "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"
    const span = scrubSentrySpan({
      description: `GET https://mempool.space/api/address/${address}`,
      data: {
        "http.url": `https://mempool.space/api/address/${address}`,
        "server.address": "mempool.space",
      },
    })
    expect(span.description?.toLowerCase()).not.toContain(address.toLowerCase())
    expect(span.description).toContain("[redacted-address]")
    expect(span.data?.["http.url"]).toBe("https://mempool.space/api/address/[redacted-address]")
    expect(span.data?.["server.address"]).toBe("mempool.space")
  })
})
