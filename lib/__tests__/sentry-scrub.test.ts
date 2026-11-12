// @vitest-environment node
import { describe, it, expect } from "vitest"
import { scrubAlertText, scrubSentryEvent } from "../sentry-scrub"

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

  it("redacts standalone bearer tokens", () => {
    const scrubbed = scrubAlertText("request failed with Bearer abc.def-123")
    expect(scrubbed).toContain("Bearer [redacted]")
    expect(scrubbed).not.toContain("abc.def-123")
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

  it("redacts wallet custody, transcript and watch material in structured diagnostics", () => {
    const event = scrubSentryEvent({ extra: {
      deviceShare: { ciphertextHex: "private" }, prfOutput: [1, 2, 3], credentialId: "credential-id",
      aBroadcastHex: "public-but-linkable", bToAHex: "private-contribution", publicPackageHex: "wallet-graph",
      scripthash: "script-id", descriptor: "descriptor-body", indexerUrl: "https://node.example.test/api",
    } })
    expect(Object.values(event!.extra!)).toEqual(Array(9).fill("[redacted]"))
  })

  it("redacts wallet byte strings, extended public keys and connection URLs in free text", () => {
    const data = "ab".repeat(200)
    const xpub = "xpub" + "1".repeat(107)
    const event = scrubSentryEvent({
      message: `Failed ${data} ${xpub}`,
      breadcrumbs: [{ data: { url: "wss://private-node.example.test:50004/socket", error: "indexer unavailable" } }],
    })
    expect(event!.message).not.toContain(data)
    expect(event!.message).not.toContain(xpub)
    expect(event!.breadcrumbs![0].data!.url).not.toContain("private-node")
    expect(event!.breadcrumbs![0].data!.error).toBe("indexer unavailable")
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
})
