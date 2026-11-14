import { looksLikeAsymmetricCiphertext } from "@/lib/crypto"

/**
 * Financial Runway journal validators.
 *
 * A5 is a standalone slice: it must NOT import from the (separately proposed)
 * runway-need, runway-gap, or expense-insight modules. The validators here only
 * check shape — they never touch user identity (the caller supplies userId from
 * the session) and never log anything, especially not ciphertext.
 *
 * The journal body is *ciphertext*: the client encrypts the note like a
 * transaction note before it is sent, and the server stores and returns only
 * that opaque string. A normal sentence is rejected. The server does not
 * decrypt the note and does not prove the box opens.
 */

// ---------------------------------------------------------------------------
// Result type (mirrors lib/runway-plan.ts for consistency)
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const MONTH_KEY_RE = /^\d{4}-\d{2}$/

/**
 * Maximum ciphertext length we accept for a journal note. Encrypted bodies are
 * base64-ish strings that expand past the plaintext; a generous cap keeps a
 * single row bounded without rejecting long reflections. ~64 KB of ciphertext
 * is far more than any realistic monthly note.
 */
export const MAX_JOURNAL_BODY_LENGTH = 64_000

/** CUID-shaped id bound (ids are short; reject absurdly long values early). */
const MAX_ID_LENGTH = 64

export interface RunwayJournalInput {
  monthKey: string
  encryptedBody: string
  envelopeId: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Validates a `YYYY-MM` month key with the month constrained to 01–12. */
export function validateMonthKey(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || !MONTH_KEY_RE.test(value)) {
    return { ok: false, error: "Month must look like YYYY-MM." }
  }
  const month = Number(value.slice(5, 7))
  if (month < 1 || month > 12) {
    return { ok: false, error: "Month must be between 01 and 12." }
  }
  return { ok: true, value }
}

/**
 * Validates the encrypted journal body. It must look like a sealed box
 * (the same wire format as transaction notes). A sentence is rejected.
 * The stored string is not trimmed or rewritten.
 */
export function validateEncryptedBody(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: "Your note is missing." }
  }
  if (value.trim() === "") {
    return { ok: false, error: "Your note is empty." }
  }
  if (value.length > MAX_JOURNAL_BODY_LENGTH) {
    return { ok: false, error: "Your note is too long." }
  }
  if (!looksLikeAsymmetricCiphertext(value)) {
    return {
      ok: false,
      error: "Your note has to be protected before it can be saved. Unlock the app and try again.",
    }
  }
  return { ok: true, value }
}

/** Optional envelope id. Empty / null / undefined means "no envelope". */
export function validateEnvelopeId(
  value: unknown,
): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "That envelope reference is not valid." }
  }
  if (value.length > MAX_ID_LENGTH) {
    return { ok: false, error: "That envelope reference is not valid." }
  }
  return { ok: true, value }
}

/** Validates an id used to look up / mutate a single journal entry. */
export function validateEntryId(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "A journal entry id is required." }
  }
  if (value.length > MAX_ID_LENGTH) {
    return { ok: false, error: "That journal entry id is not valid." }
  }
  return { ok: true, value }
}

/**
 * Parse and validate a full create body: `{ monthKey, encryptedBody, envelopeId? }`.
 * Returns plain-language errors; never throws.
 */
export function parseRunwayJournalCreate(
  body: unknown,
): ValidationResult<RunwayJournalInput> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Expected a journal note." }
  }

  const monthKey = validateMonthKey(body.monthKey)
  if (!monthKey.ok) return monthKey

  const encryptedBody = validateEncryptedBody(body.encryptedBody)
  if (!encryptedBody.ok) return encryptedBody

  const envelopeId = validateEnvelopeId(body.envelopeId)
  if (!envelopeId.ok) return envelopeId

  return {
    ok: true,
    value: {
      monthKey: monthKey.value,
      encryptedBody: encryptedBody.value,
      envelopeId: envelopeId.value,
    },
  }
}

export interface RunwayJournalUpdateInput {
  id: string
  encryptedBody: string
  /** Present only when the client sent an envelopeId key (allows clearing). */
  envelopeId?: string | null
}

/**
 * Parse and validate an update body: `{ id, encryptedBody, envelopeId? }`. The
 * month key is immutable (a note belongs to the month it was written for), so
 * it is not accepted here. `envelopeId` is only included in the result when the
 * client explicitly sent the key, so callers can distinguish "leave unchanged"
 * from "clear the envelope".
 */
export function parseRunwayJournalUpdate(
  body: unknown,
): ValidationResult<RunwayJournalUpdateInput> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Expected a journal note." }
  }

  const id = validateEntryId(body.id)
  if (!id.ok) return id

  const encryptedBody = validateEncryptedBody(body.encryptedBody)
  if (!encryptedBody.ok) return encryptedBody

  const result: RunwayJournalUpdateInput = {
    id: id.value,
    encryptedBody: encryptedBody.value,
  }

  if ("envelopeId" in body) {
    const envelopeId = validateEnvelopeId(body.envelopeId)
    if (!envelopeId.ok) return envelopeId
    result.envelopeId = envelopeId.value
  }

  return { ok: true, value: result }
}
