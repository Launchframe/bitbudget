/**
 * Turn a shared receipt into per-person cent shares.
 * Item amounts follow the person who asked. Anything left is split evenly.
 */

import { suggestMatchesForLine, type ShoppingMatchRequest } from "@/lib/shopping-item-matcher"
import { allocateReceiptCents, ShoppingSplitError } from "@/lib/shopping-split-math"

export class ReceiptPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReceiptPlanError"
  }
}

export interface PlannedReceiptLine {
  cents: number
  /** One member, or every active member when the item is shared. */
  memberIds: readonly string[]
}

export function suggestShoppingRequestId(
  description: string,
  requests: readonly ShoppingMatchRequest[],
): string | null {
  const trimmed = description.trim()
  if (!trimmed) return null
  const hits = suggestMatchesForLine(
    { id: "draft", description: trimmed, quantity: 1, unit: "each" },
    requests,
  )
  return hits[0]?.requestId ?? null
}

export function planSharedReceiptShares(params: {
  totalCents: number
  memberIds: readonly string[]
  lines: readonly PlannedReceiptLine[]
}): Array<{ memberId: string; cents: number }> {
  if (!Number.isInteger(params.totalCents) || params.totalCents <= 0) {
    throw new ReceiptPlanError("Enter a valid total")
  }
  const memberIds = [...new Set(params.memberIds)]
  if (memberIds.length === 0) {
    throw new ReceiptPlanError("Add someone to the group before splitting a receipt")
  }
  const allowed = new Set(memberIds)
  let lineSum = 0
  const normalized: PlannedReceiptLine[] = []
  for (const line of params.lines) {
    if (!Number.isInteger(line.cents) || line.cents <= 0) {
      throw new ReceiptPlanError("Enter an amount for each item")
    }
    const lineMembers = [...new Set(line.memberIds)]
    if (lineMembers.length === 0) {
      throw new ReceiptPlanError("Each item needs someone to cover it")
    }
    for (const memberId of lineMembers) {
      if (!allowed.has(memberId)) {
        throw new ReceiptPlanError("That person is not in this group")
      }
    }
    lineSum += line.cents
    normalized.push({ cents: line.cents, memberIds: lineMembers })
  }
  if (lineSum > params.totalCents) {
    throw new ReceiptPlanError("Items add up to more than the receipt total")
  }

  const allocationLines = normalized.map((line, index) => ({
    lineId: `line-${index}`,
    netCents: line.cents,
    assignments: line.memberIds.map((memberId) => ({
      requestId: line.memberIds.length === 1 ? "one" : "all",
      memberId,
      quantity: 1,
    })),
  }))
  const gap = params.totalCents - lineSum
  if (gap > 0) {
    allocationLines.push({
      lineId: "rest",
      netCents: gap,
      assignments: memberIds.map((memberId) => ({
        requestId: "rest",
        memberId,
        quantity: 1,
      })),
    })
  }

  try {
    const totals = allocateReceiptCents({
      lines: allocationLines,
      charges: { taxCents: 0, discountCents: 0, feeCents: 0 },
      totalCents: params.totalCents,
    })
    return totals
      .filter((row) => row.totalCents > 0)
      .map((row) => ({ memberId: row.memberId, cents: row.totalCents }))
  } catch (err) {
    if (err instanceof ShoppingSplitError) {
      throw new ReceiptPlanError("Could not split this receipt")
    }
    throw err
  }
}

/**
 * Who covers one receipt line. A linked list item is charged to the person
 * who asked. Anything else is split across active members.
 */
export function memberIdsForPlannedReceiptLine(params: {
  requestId: string | null
  activeMemberIds: readonly string[]
  requests: readonly { id: string; requesterMemberId: string }[]
}): string[] {
  const active = [...new Set(params.activeMemberIds)]
  if (!params.requestId) return active
  const request = params.requests.find((item) => item.id === params.requestId)
  if (!request) throw new ReceiptPlanError("That item is no longer on the list")
  if (!active.includes(request.requesterMemberId)) {
    throw new ReceiptPlanError("That person is not in this group")
  }
  return [request.requesterMemberId]
}

/**
 * Keep an explicit "who asked" choice. Suggestions only fill an untouched row.
 */
export function assignmentForReceiptDescription(params: {
  touched: boolean
  requestId: string
  description: string
  requests: readonly ShoppingMatchRequest[]
}): string {
  if (params.touched) return params.requestId
  return suggestShoppingRequestId(params.description, params.requests) ?? ""
}

/** List items a saved receipt should mark purchased. Already purchased items are skipped. */
export function receiptRequestIdsToCheckOff(
  lines: readonly { requestId: string | null }[],
  requests: readonly { id: string; checkedOff: boolean }[],
): string[] {
  const open = new Set(requests.filter((request) => !request.checkedOff).map((request) => request.id))
  const ids: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (!line.requestId || seen.has(line.requestId) || !open.has(line.requestId)) continue
    seen.add(line.requestId)
    ids.push(line.requestId)
  }
  return ids
}

export interface ReceiptFinancialAttempt {
  receiptId: string
  operationId: string
  finalized: boolean
}

/**
 * One receipt id and one operation id for the whole save, including retries.
 * A finalized attempt must not start another receipt.
 */
export function continueReceiptFinancialAttempt(
  current: ReceiptFinancialAttempt | null,
  mint: () => { receiptId: string; operationId: string },
): { attempt: ReceiptFinancialAttempt; writeFinancial: boolean } {
  if (current?.finalized) return { attempt: current, writeFinancial: false }
  if (current) return { attempt: current, writeFinancial: true }
  return { attempt: { ...mint(), finalized: false }, writeFinancial: true }
}

export function markReceiptFinancialAttemptFinalized(
  attempt: ReceiptFinancialAttempt,
): ReceiptFinancialAttempt {
  return { ...attempt, finalized: true }
}

export const RECEIPT_CHECKOFF_WARNING =
  "Receipt saved. Some items stayed on the list. Mark them purchased if you bought them."

export const RECEIPT_SEQUENCE_RETRY_MESSAGE =
  "The shared list changed. Review the split and save again."

export function isReceiptAlreadyFinalizedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("already finalized")
}

export function isReceiptSequenceConflictError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("shared tab changed")
}
