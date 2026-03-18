import crypto from "crypto"

/**
 * Validates X-Twilio-Signature for POST webhooks.
 * @param url Exact webhook URL configured in Twilio (e.g. https://bitbudget.io/api/webhooks/sms)
 */
export function verifyTwilioWebhookSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature || !authToken || !url) return false
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64")
  try {
    const a = Buffer.from(signature, "utf8")
    const b = Buffer.from(expected, "utf8")
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
