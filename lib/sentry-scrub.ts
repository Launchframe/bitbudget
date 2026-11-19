const SENSITIVE_KEY = /email|password|token|secret|encrypted|privacy|nsec|npub|authorization|cookie|payee|notes|encryptedprivacykey|privacykeysalt|crons_secret|cron_secret|invite|alias|receipt|shopping/i
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const NSEC_RE = /\bnsec1[a-z0-9]+\b/gi
const NPUB_RE = /\bnpub1[a-z0-9]+\b/gi
const HEX64_RE = /\b[0-9a-f]{64}\b/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
/** Mainnet addresses only. Bech32 is case-insensitive; base58 keeps its alphabet. */
const BITCOIN_ADDRESS_RE =
  /\b(?:bc1[02-9ac-hj-np-z]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/gi
const SENSITIVE_TEXT_PAIR_RE =
  /(["']?)(email|password|passphrase|pin|token|secret|encryptedPrivacyKey|privacyKeySalt|authorization|cookie|nsec|npub|payee|notes|accessToken|refreshToken|inviteToken|verificationCode|alias|merchant)\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}&\]]+)/gi

function redactString(value: string): string {
  return value
    .replace(SENSITIVE_TEXT_PAIR_RE, (_match, quote: string, key: string, separator: string) => `${quote}${key}${quote}${separator}[redacted]`)
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(NSEC_RE, "[redacted-nsec]")
    .replace(NPUB_RE, "[redacted-npub]")
    .replace(HEX64_RE, "[redacted-hex]")
    .replace(new RegExp(BITCOIN_ADDRESS_RE.source, BITCOIN_ADDRESS_RE.flags), "[redacted-address]")
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]"
  if (value == null) return value
  if (typeof value === "string") return redactString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(v => scrubValue(v, depth + 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[redacted]"
      } else {
        out[k] = scrubValue(v, depth + 1)
      }
    }
    return out
  }
  return "[redacted]"
}

interface SentryExceptionValue {
  type?: string
  value?: string
  [key: string]: unknown
}

export interface ScrubbableSentrySpan {
  description?: string
  data?: object
  name?: string
}

interface ScrubbableSentryEvent {
  message?: string
  transaction?: string
  user?: { id?: string; email?: string; [key: string]: unknown }
  request?: {
    headers?: Record<string, string>
    cookies?: unknown
    [key: string]: unknown
  }
  exception?: { values?: SentryExceptionValue[] }
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>
  spans?: ScrubbableSentrySpan[]
}

/**
 * Scrub a span payload. Static tracing puts the full fetch URL in
 * `description` and `data["http.url"]`. Returning the same span keeps it;
 * dropping spans is not allowed by the SDK.
 */
export function scrubSentrySpan<T extends ScrubbableSentrySpan>(span: T): T {
  if (typeof span.description === "string") {
    span.description = redactString(span.description)
  }
  if (typeof span.name === "string") {
    span.name = redactString(span.name)
  }
  if (span.data) {
    const record = span.data as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const value = record[key]
      if (typeof value === "string") record[key] = redactString(value)
    }
  }
  return span
}

/** Scrub PII from Sentry events before send (AGENTS.md privacy contract). */
export function scrubSentryEvent(event: ScrubbableSentryEvent, hint?: unknown): ScrubbableSentryEvent | null {
  void hint
  if (event.message) {
    event.message = redactString(event.message)
  }
  if (typeof event.transaction === "string") {
    event.transaction = redactString(event.transaction)
  }
  if (event.request) {
    const request = scrubValue(event.request) as NonNullable<ScrubbableSentryEvent["request"]>
    if (request.headers) {
      const headers = { ...request.headers }
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_KEY.test(key)) headers[key] = "[redacted]"
      }
      request.headers = headers
    }
    if (request.cookies) {
      request.cookies = "[redacted]"
    }
    event.request = request
  }
  if (event.user) {
    event.user = { id: event.user.id ? "[user]" : undefined }
  }
  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>
  }
  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as Record<string, unknown>
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(b => ({
      ...b,
      message: b.message ? redactString(b.message) : b.message,
      data: b.data ? (scrubValue(b.data) as Record<string, unknown>) : b.data,
    }))
  }
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(v => ({
      ...v,
      value: v.value ? redactString(v.value) : v.value,
    }))
  }
  if (event.spans) {
    for (const span of event.spans) scrubSentrySpan(span)
  }
  return event
}

/** Scrub free-text alert bodies before Discord/Telegram/email. */
export function scrubAlertText(text: string): string {
  return redactString(text)
}
