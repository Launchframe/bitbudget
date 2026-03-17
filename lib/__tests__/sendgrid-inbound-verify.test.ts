import { describe, expect, it } from "vitest"
import {
  isSendGridWebhookTimestampFresh,
  parseMultipartFormFields,
} from "../sendgrid-inbound-verify"

describe("isSendGridWebhookTimestampFresh", () => {
  it("accepts current unix time", () => {
    const now = String(Math.floor(Date.now() / 1000))
    expect(isSendGridWebhookTimestampFresh(now, 600)).toBe(true)
  })

  it("rejects stale timestamps", () => {
    const old = String(Math.floor(Date.now() / 1000) - 700)
    expect(isSendGridWebhookTimestampFresh(old, 600)).toBe(false)
  })

  it("rejects invalid", () => {
    expect(isSendGridWebhookTimestampFresh("", 600)).toBe(false)
    expect(isSendGridWebhookTimestampFresh("abc", 600)).toBe(false)
  })
})

describe("parseMultipartFormFields", () => {
  it("extracts text fields from multipart body", async () => {
    const boundary = "----testboundary"
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="from"',
        "",
        "user@example.com",
        `--${boundary}`,
        'Content-Disposition: form-data; name="text"',
        "",
        "Paid Store $5.00",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
      "utf8",
    )
    const ct = `multipart/form-data; boundary=${boundary}`
    const fields = await parseMultipartFormFields(body, ct)
    expect(fields.from).toBe("user@example.com")
    expect(fields.text).toBe("Paid Store $5.00")
  })
})
