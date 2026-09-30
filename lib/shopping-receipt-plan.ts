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
  for (const line of params.lines) {
    if (!Number.isInteger(line.cents) || line.cents <= 0) {
      throw new ReceiptPlanError("Enter an amount for each item")
    }
    if (line.memberIds.length === 0) {
      throw new ReceiptPlanError("Each item needs someone to cover it")
    }
    for (const memberId of line.memberIds) {
      if (!allowed.has(memberId)) {
        throw new ReceiptPlanError("That person is not in this group")
      }
    }
    lineSum += line.cents
  }
  if (lineSum > params.totalCents) {
    throw new ReceiptPlanError("Items add up to more than the receipt total")
  }

  const allocationLines = params.lines.map((line, index) => ({
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
