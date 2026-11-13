/**
 * Client-side validation of decrypted shopping event payloads.
 * The server cannot inspect encrypted splits; this is the trusted-group check.
 */

import {
  SHOPPING_PAYLOAD_SCHEMA_VERSION,
  type ShoppingEventPayload,
  type ShoppingMemberShare,
} from "@/lib/shopping-types"
import { canRecordRepayment } from "@/lib/shopping-ledger"

export class ShoppingEventValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShoppingEventValidationError"
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ShoppingEventValidationError(`${label} is required`)
  }
  return value
}

function requireCents(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ShoppingEventValidationError(`${label} must be a whole-cent amount`)
  }
  return value
}

function requirePostedOn(value: unknown): string {
  const s = requireString(value, "Date")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ShoppingEventValidationError("Date must be YYYY-MM-DD")
  }
  return s
}

function parseShares(value: unknown): ShoppingMemberShare[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ShoppingEventValidationError("Receipt needs at least one share")
  }
  const shares: ShoppingMemberShare[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      throw new ShoppingEventValidationError("Invalid share")
    }
    const row = raw as Record<string, unknown>
    const memberId = requireString(row.memberId, "Member")
    if (seen.has(memberId)) {
      throw new ShoppingEventValidationError("Each person can appear once on a receipt")
    }
    seen.add(memberId)
    const cents = requireCents(row.cents, "Share")
    if (cents < 0) throw new ShoppingEventValidationError("Share cannot be negative")
    shares.push({ memberId, cents })
  }
  return shares
}

function parseReceiptInner(raw: Record<string, unknown>): Omit<
  Extract<ShoppingEventPayload, { type: "receipt_finalized" }>,
  "schemaVersion"
> {
  const shares = parseShares(raw.shares)
  const totalCents = requireCents(raw.totalCents, "Total")
  if (totalCents < 0) throw new ShoppingEventValidationError("Total cannot be negative")
  const shareSum = shares.reduce((s, sh) => s + sh.cents, 0)
  if (shareSum !== totalCents) {
    throw new ShoppingEventValidationError("Shares must add up to the receipt total")
  }
  const payerMemberId = requireString(raw.payerMemberId, "Payer")
  if (raw.currency !== "USD") {
    throw new ShoppingEventValidationError("Only US dollars are supported")
  }
  return {
    type: "receipt_finalized",
    receiptId: requireString(raw.receiptId, "Receipt"),
    payerMemberId,
    postedOn: requirePostedOn(raw.postedOn),
    currency: "USD",
    totalCents,
    shares,
  }
}

function parseRepaymentInner(raw: Record<string, unknown>): Omit<
  Extract<ShoppingEventPayload, { type: "repayment" }>,
  "schemaVersion"
> {
  const fromMemberId = requireString(raw.fromMemberId, "From")
  const toMemberId = requireString(raw.toMemberId, "To")
  const cents = requireCents(raw.cents, "Amount")
  if (cents <= 0) throw new ShoppingEventValidationError("Amount must be greater than zero")
  if (fromMemberId === toMemberId) {
    throw new ShoppingEventValidationError("Choose two different people")
  }
  let allocations: Array<{ receiptEventId: string; cents: number }> | undefined
  if (raw.allocations !== undefined) {
    if (!Array.isArray(raw.allocations)) {
      throw new ShoppingEventValidationError("Invalid payment allocation")
    }
    allocations = raw.allocations.map((item) => {
      if (!item || typeof item !== "object") {
        throw new ShoppingEventValidationError("Invalid payment allocation")
      }
      const row = item as Record<string, unknown>
      const allocCents = requireCents(row.cents, "Allocation")
      if (allocCents <= 0) throw new ShoppingEventValidationError("Allocation must be greater than zero")
      return { receiptEventId: requireString(row.receiptEventId, "Receipt"), cents: allocCents }
    })
    const allocSum = allocations.reduce((s, a) => s + a.cents, 0)
    if (allocSum > cents) {
      throw new ShoppingEventValidationError("Allocated amounts exceed the payment")
    }
  }
  return {
    type: "repayment",
    fromMemberId,
    toMemberId,
    cents,
    postedOn: requirePostedOn(raw.postedOn),
    note: typeof raw.note === "string" ? raw.note : undefined,
    allocations,
  }
}

export function parseShoppingEventPayload(raw: unknown): ShoppingEventPayload {
  if (!raw || typeof raw !== "object") {
    throw new ShoppingEventValidationError("Event payload is missing")
  }
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== SHOPPING_PAYLOAD_SCHEMA_VERSION) {
    throw new ShoppingEventValidationError("Unsupported event version")
  }
  switch (obj.type) {
    case "receipt_finalized":
      return { schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION, ...parseReceiptInner(obj) }
    case "repayment":
      return { schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION, ...parseRepaymentInner(obj) }
    case "reversal":
      return {
        schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
        type: "reversal",
        reversesEventId: requireString(obj.reversesEventId, "Event"),
      }
    case "replacement": {
      if (!obj.inner || typeof obj.inner !== "object") {
        throw new ShoppingEventValidationError("Replacement is missing")
      }
      const innerObj = obj.inner as Record<string, unknown>
      const inner =
        innerObj.type === "receipt_finalized"
          ? parseReceiptInner(innerObj)
          : innerObj.type === "repayment"
            ? parseRepaymentInner(innerObj)
            : (() => {
                throw new ShoppingEventValidationError("Replacement type is not supported")
              })()
      return {
        schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
        type: "replacement",
        replacesEventId: requireString(obj.replacesEventId, "Event"),
        inner,
      }
    }
    default:
      throw new ShoppingEventValidationError("Unknown event type")
  }
}

export function assertPayerFinalizes(params: {
  actorMemberId: string
  payerMemberId: string
}): void {
  if (params.actorMemberId !== params.payerMemberId) {
    throw new ShoppingEventValidationError("Only the person who paid can finalize this receipt")
  }
}

export function assertRepaymentActor(params: {
  actorMemberId: string
  fromMemberId: string
  toMemberId: string
}): void {
  if (!canRecordRepayment(params)) {
    throw new ShoppingEventValidationError("Only the two people in this payment can record it")
  }
}

export function assertReceiptCorrectionActor(params: {
  actorMemberId: string
  originalPayerMemberId: string
}): void {
  if (params.actorMemberId !== params.originalPayerMemberId) {
    throw new ShoppingEventValidationError("Only the original payer can correct this receipt")
  }
}

export function assertPaymentCorrectionActor(params: {
  actorMemberId: string
  fromMemberId: string
  toMemberId: string
}): void {
  if (!canRecordRepayment(params)) {
    throw new ShoppingEventValidationError("Only the two people in this payment can correct it")
  }
}
