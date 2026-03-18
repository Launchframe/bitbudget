import { createPublicKey, verify as cryptoVerify } from "node:crypto"
import busboy from "busboy"

const SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature"
const TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp"

/** Max age of webhook timestamp (seconds) to limit replay attacks. */
const DEFAULT_MAX_TIMESTAMP_SKEW_SEC = 600

/**
 * Verifies SendGrid Inbound Parse webhook ECDSA signature (same scheme as Event Webhook).
 * Payload must be the raw multipart body bytes exactly as received.
 * @see https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks
 */
export function verifySendGridInboundWebhook(
  publicKeyBase64: string,
  timestamp: string,
  rawBody: Buffer,
  signatureBase64: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    })
    const data = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody])
    const signature = Buffer.from(signatureBase64, "base64")
    if (cryptoVerify("sha256", data, publicKey, signature)) {
      return true
    }
    if (signature.length === 64) {
      return cryptoVerify("sha256", data, {
        key: publicKey,
        dsaEncoding: "ieee-p1363",
      }, signature)
    }
    return false
  } catch {
    return false
  }
}

export function isSendGridWebhookTimestampFresh(
  timestampHeader: string,
  maxSkewSec: number = DEFAULT_MAX_TIMESTAMP_SKEW_SEC,
): boolean {
  const ts = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(ts) || ts < 1) return false
  const now = Math.floor(Date.now() / 1000)
  return Math.abs(now - ts) <= maxSkewSec
}

export function getSendGridInboundHeaders(req: Request): {
  signature: string | null
  timestamp: string | null
} {
  const sig =
    req.headers.get(SIGNATURE_HEADER) ??
    req.headers.get("X-Twilio-Email-Event-Webhook-Signature")
  const ts =
    req.headers.get(TIMESTAMP_HEADER) ??
    req.headers.get("X-Twilio-Email-Event-Webhook-Timestamp")
  return { signature: sig, timestamp: ts }
}

/**
 * Parse multipart/form-data fields from a raw body (after signature verification).
 * File parts are drained and ignored (SendGrid may attach files).
 */
export function parseMultipartFormFields(
  buffer: Buffer,
  contentType: string,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {}
    const bb = busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8",
    })
    bb.on("field", (name, val) => {
      fields[name] = val
    })
    bb.on("file", (_name, file) => {
      file.resume()
    })
    bb.on("error", (err: Error) => reject(err))
    bb.on("finish", () => resolve(fields))
    bb.end(buffer)
  })
}
