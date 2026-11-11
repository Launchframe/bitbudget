/**
 * Validators & parsers for the Runway pending-sale API (slice B6).
 *
 * A pending sale tracks bitcoin the user is selling to refill their cash floor
 * before the deposit lands. These helpers validate and normalize client
 * payloads into the shape the API route persists; the status state machine and
 * holdings math live in `lib/runway-refill.ts`. All errors are plain-language.
 */

import { coerceDecimal12_2Input } from "@/lib/decimal-validation"
import { validateSats, type ParseResult } from "@/lib/btc-loan"
import type { PendingSaleStatus } from "@/lib/runway-refill"

export const PENDING_SALE_STATUSES: readonly PendingSaleStatus[] = [
  "sent",
  "cash_on_the_way",
  "linked",
  "cancelled",
]

/** Statuses a client may transition a sale into via PATCH. */
const PATCHABLE_STATUSES: readonly PendingSaleStatus[] = [
  "cash_on_the_way",
  "linked",
  "cancelled",
]

export interface PendingSaleCreateInput {
  sats: number
  markPriceUsd: number
}

export interface PendingSaleUpdateInput {
  status?: PendingSaleStatus
  proceedsUsd?: number | null
  linkedTransactionId?: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateStatus(value: unknown): ParseResult<PendingSaleStatus> {
  if (
    value === "sent" ||
    value === "cash_on_the_way" ||
    value === "linked" ||
    value === "cancelled"
  ) {
    return { ok: true, value }
  }
  return {
    ok: false,
    error: "Status must be one of: sent, cash_on_the_way, linked, cancelled",
  }
}

/**
 * Parse a create body. A new sale always starts as `sent`; the client supplies
 * the sats that left the wallet and the spot mark price at send time.
 */
export function parsePendingSaleCreateBody(
  raw: unknown,
): ParseResult<PendingSaleCreateInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Expected a JSON object" }
  }

  const sats = validateSats(raw.sats, "Sats")
  if (!sats.ok) return sats
  if (sats.value <= 0) {
    return { ok: false, error: "A sale must move at least some bitcoin" }
  }

  const markPriceUsd = coerceDecimal12_2Input(raw.markPriceUsd, "Mark price")
  if (!markPriceUsd.ok) return markPriceUsd
  if (markPriceUsd.value <= 0) {
    return { ok: false, error: "Mark price must be greater than zero" }
  }

  return { ok: true, value: { sats: sats.value, markPriceUsd: markPriceUsd.value } }
}

/**
 * Parse an update body. Requires at least one of: a status transition, proceeds,
 * or a linked transaction id. When moving to `cash_on_the_way`, proceeds are
 * required. `proceedsUsd: null` and `linkedTransactionId: null` clear the field.
 */
export function parsePendingSaleUpdateBody(
  raw: unknown,
): ParseResult<PendingSaleUpdateInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Expected a JSON object" }
  }

  const out: PendingSaleUpdateInput = {}

  if ("status" in raw) {
    const r = validateStatus(raw.status)
    if (!r.ok) return r
    if (!PATCHABLE_STATUSES.includes(r.value)) {
      return {
        ok: false,
        error: "A sale can only move to cash_on_the_way, linked, or cancelled",
      }
    }
    out.status = r.value
  }

  if ("proceedsUsd" in raw) {
    if (raw.proceedsUsd == null) {
      out.proceedsUsd = null
    } else {
      const r = coerceDecimal12_2Input(raw.proceedsUsd, "Proceeds")
      if (!r.ok) return r
      out.proceedsUsd = r.value
    }
  }

  if ("linkedTransactionId" in raw) {
    if (raw.linkedTransactionId == null) {
      out.linkedTransactionId = null
    } else if (typeof raw.linkedTransactionId === "string") {
      const trimmed = raw.linkedTransactionId.trim()
      out.linkedTransactionId = trimmed === "" ? null : trimmed
    } else {
      return { ok: false, error: "Linked transaction id must be a string" }
    }
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, error: "No updatable fields were provided" }
  }

  if (out.status === "cash_on_the_way" && out.proceedsUsd == null) {
    return {
      ok: false,
      error: "Recording cash on the way needs the proceeds amount",
    }
  }

  return { ok: true, value: out }
}
