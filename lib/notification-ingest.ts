import { composeBankAlertText, parseBankAlertText } from "@/lib/bank-alert-parser"
import {
  claimNotificationIngestIdempotency,
  normalizeIdempotencyKey,
  notificationIngestAlreadySeen,
  releaseNotificationIngestIdempotency,
} from "@/lib/notification-ingest-idempotency"
import { routeTransaction } from "@/lib/confidence-router"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { assertPremiumTrialInboxAllowed, requirePremiumOrTrial } from "@/lib/subscription"

export const NOTIFICATION_FORWARD_SOURCE = "notification_forward"

/** Max characters accepted in composed alert text (before OpenAI). */
export const NOTIFICATION_ALERT_TEXT_MAX_LEN = 8_000

export interface NotificationIngestPayload {
  text?: string | null
  title?: string | null
  body?: string | null
  package?: string | null
  postedAt?: string | null
  idempotencyKey?: string | null
}

export type NotificationIngestResult =
  | { ok: true; route: "live" | "pending"; id: string; deduplicated?: false }
  | { ok: true; deduplicated: true }
  | { ok: false; status: number; error: string; message?: string }

export async function ingestNotificationAlert(
  userId: string,
  payload: NotificationIngestPayload,
): Promise<NotificationIngestResult> {
  if (!(await requirePremiumOrTrial(userId))) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden",
      message: "Notification forwarding requires premium or an active premium trial",
    }
  }

  const cap = await assertPremiumTrialInboxAllowed(userId)
  if (!cap.ok) {
    return { ok: false, status: 403, error: "Forbidden", message: cap.message }
  }

  const alertText = composeBankAlertText(payload)
  if (!alertText) {
    return {
      ok: false,
      status: 400,
      error: "Missing required fields",
      message: "Provide text or both title and body",
    }
  }
  if (alertText.length > NOTIFICATION_ALERT_TEXT_MAX_LEN) {
    return {
      ok: false,
      status: 413,
      error: "Payload too large",
      message: `Alert text must be at most ${NOTIFICATION_ALERT_TEXT_MAX_LEN} characters`,
    }
  }

  const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey)
  let idempotencyClaimed = false

  const releaseClaim = async () => {
    if (idempotencyClaimed && idempotencyKey) {
      await releaseNotificationIngestIdempotency(userId, idempotencyKey)
      idempotencyClaimed = false
    }
  }

  if (idempotencyKey) {
    if (await notificationIngestAlreadySeen(userId, idempotencyKey)) {
      return { ok: true, deduplicated: true }
    }
    const claim = await claimNotificationIngestIdempotency(userId, idempotencyKey)
    if (claim === "duplicate") {
      return { ok: true, deduplicated: true }
    }
    idempotencyClaimed = true
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    await releaseClaim()
    return {
      ok: false,
      status: 503,
      error: "Service unavailable",
      message: "Alert parsing is not configured on this server.",
    }
  }

  let parsed
  try {
    parsed = await parseBankAlertText(alertText)
  } catch (err) {
    await releaseClaim()
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes("429") || message.includes("rate limit")) {
      return {
        ok: false,
        status: 503,
        error: "Rate limited",
        message: "Alert parsing is temporarily rate-limited. Try again in a minute.",
      }
    }
    return { ok: false, status: 422, error: "Could not parse alert", message }
  }

  if (!parsed) {
    await releaseClaim()
    return {
      ok: false,
      status: 422,
      error: "Could not parse alert",
      message: "No valid payee and amount found in notification text",
    }
  }

  const date = payload.postedAt ? new Date(payload.postedAt) : new Date(parsed.date)
  if (Number.isNaN(date.getTime())) {
    await releaseClaim()
    return { ok: false, status: 400, error: "Invalid postedAt" }
  }

  const envelopeMatch = await matchEnvelope(userId, parsed.payee)
  const confidence = envelopeMatch?.confidence ?? 0.3
  const pkg = payload.package?.trim()
  const rawPrefix = idempotencyKey ? `idempotency:${idempotencyKey}\n` : ""
  const rawInput = `${rawPrefix}${pkg ? `package:${pkg}\n` : ""}${alertText.slice(0, 500)}`

  const result = await routeTransaction(userId, {
    payee: parsed.payee,
    amount: parsed.amount,
    date,
    source: NOTIFICATION_FORWARD_SOURCE,
    suggestedEnvelopeId: envelopeMatch?.envelopeId ?? null,
    confidence,
    rawInput,
  })

  idempotencyClaimed = false
  return { ok: true, route: result.route, id: result.id }
}
