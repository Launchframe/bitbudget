import crypto from "crypto"
import { describe, expect, it } from "vitest"
import { verifyTwilioWebhookSignature } from "@/lib/twilio-webhook-verify"

describe("verifyTwilioWebhookSignature", () => {
  it("accepts valid Twilio-style signature", () => {
    const authToken = "test-auth-token"
    const url = "https://example.com/api/webhooks/sms"
    const params = { Body: "hello", From: "+15551234567" }
    const sorted = Object.keys(params).sort()
    let data = url
    for (const k of sorted) data += k + params[k as keyof typeof params]
    const sig = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64")
    expect(verifyTwilioWebhookSignature(authToken, sig, url, params)).toBe(true)
  })

  it("rejects wrong signature", () => {
    expect(
      verifyTwilioWebhookSignature(
        "token",
        "not-valid-base64-sig",
        "https://x.com",
        { a: "1" },
      ),
    ).toBe(false)
  })
})
