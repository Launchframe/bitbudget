/**
 * Compare-and-swap helpers for shopping list collaboration.
 * Financial writes use the group event sequence; list/request rows use per-object revision.
 */

import { SHOPPING_MAX_EVENTS_PAGE } from "@/lib/shopping-types"

export class ShoppingRevisionConflictError extends Error {
  readonly currentRevision: number
  constructor(currentRevision: number) {
    super("This item changed on another device. Refresh and try again.")
    this.name = "ShoppingRevisionConflictError"
    this.currentRevision = currentRevision
  }
}

export class ShoppingStaleSequenceError extends Error {
  readonly currentSequence: number
  constructor(currentSequence: number) {
    super("The shared tab changed. Refresh and review before saving.")
    this.name = "ShoppingStaleSequenceError"
    this.currentSequence = currentSequence
  }
}

export function assertExpectedRevision(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("Invalid revision")
  }
  if (actual !== expected) {
    throw new ShoppingRevisionConflictError(actual)
  }
}

export function nextRevision(current: number): number {
  return current + 1
}

export function assertExpectedSequence(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 0) {
    throw new Error("Invalid sequence")
  }
  if (actual !== expected) {
    throw new ShoppingStaleSequenceError(actual)
  }
}

/** First sequence included in a tail snapshot window (null when the group has no events yet). */
export function shoppingEventWindowStart(
  eventSequence: number,
  pageSize: number = SHOPPING_MAX_EVENTS_PAGE,
): number | null {
  if (eventSequence <= 0) return null
  if (eventSequence <= pageSize) return 1
  return eventSequence - pageSize + 1
}

/** Prisma `where` clause for the newest `pageSize` shopping ledger events. */
export function shoppingEventSnapshotWhere(
  eventSequence: number,
  pageSize: number = SHOPPING_MAX_EVENTS_PAGE,
): { sequence?: { gte: number } } {
  const start = shoppingEventWindowStart(eventSequence, pageSize)
  if (start == null || start <= 1) return {}
  return { sequence: { gte: start } }
}

export type ShoppingEventPagePlan =
  | { ok: false; reason: "both" | "invalid" }
  | {
      ok: true
      sequence: { gt: number } | { lt: number }
      order: "asc" | "desc"
      /** Rows to fetch, one past the page so the caller can set `hasMore`. */
      take: number
      pageSize: number
      /** Descending history pages are flipped to ascending before they are returned. */
      reverse: boolean
    }

/**
 * One cursor per request.
 * `afterSequence` walks forward (`sequence > cursor`).
 * `beforeSequence` walks backward to the page immediately older than the cursor
 * (the snapshot tail's `oldestIncludedSequence`).
 */
export function planShoppingEventPage(input: {
  afterSequence: number | null
  beforeSequence: number | null
  pageSize?: number
}): ShoppingEventPagePlan {
  const requested = input.pageSize ?? SHOPPING_MAX_EVENTS_PAGE
  if (!Number.isInteger(requested)) return { ok: false, reason: "invalid" }
  const pageSize = Math.min(Math.max(1, requested), SHOPPING_MAX_EVENTS_PAGE)
  const hasAfter = input.afterSequence != null
  const hasBefore = input.beforeSequence != null
  if (hasAfter && hasBefore) return { ok: false, reason: "both" }
  if (!hasAfter && !hasBefore) return { ok: false, reason: "invalid" }
  if (hasAfter) {
    if (!Number.isInteger(input.afterSequence) || (input.afterSequence ?? -1) < 0) {
      return { ok: false, reason: "invalid" }
    }
    return {
      ok: true,
      sequence: { gt: input.afterSequence as number },
      order: "asc",
      take: pageSize + 1,
      pageSize,
      reverse: false,
    }
  }
  if (!Number.isInteger(input.beforeSequence) || (input.beforeSequence ?? -1) < 0) {
    return { ok: false, reason: "invalid" }
  }
  return {
    ok: true,
    sequence: { lt: input.beforeSequence as number },
    order: "desc",
    take: pageSize + 1,
    pageSize,
    reverse: true,
  }
}

export type ShoppingOutboxKind = "request_upsert" | "request_checkoff" | "list_upsert"

export interface ShoppingOutboxItem {
  id: string
  groupId: string
  kind: ShoppingOutboxKind
  objectId: string
  expectedRevision: number
  encryptedPayload: string
  keyVersion: number
  queuedAt: string
}

export function canQueueOffline(kind: ShoppingOutboxKind): boolean {
  return kind === "request_upsert" || kind === "request_checkoff" || kind === "list_upsert"
}

/** Financial commits (receipts, repayments) must not enter the offline outbox. */
export function isFinancialShoppingMutation(kind: string): boolean {
  return (
    kind === "receipt_finalize" ||
    kind === "repayment" ||
    kind === "reversal" ||
    kind === "replacement" ||
    kind === "key_rotation"
  )
}
