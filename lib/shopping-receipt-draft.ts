/**
 * In-progress shared receipt form. Session-only; cleared on save, Clear All, and logout.
 */

import { clearDraft, loadDraft, saveDraft, saveDraftImmediate } from "@/lib/draft-storage"

export const SHOPPING_RECEIPT_DRAFT_KEY = "bitbudget-shopping-receipt-draft"

export interface ShoppingReceiptDraftRow {
  key: string
  description: string
  amount: string
  requestId: string
  touched: boolean
}

export interface ShoppingReceiptDraftV1 {
  version: 1
  groupId: string
  merchant: string
  amount: string
  rows: ShoppingReceiptDraftRow[]
}

function isRow(value: unknown): value is ShoppingReceiptDraftRow {
  if (typeof value !== "object" || value == null) return false
  const row = value as ShoppingReceiptDraftRow
  return (
    typeof row.key === "string" &&
    row.key.length > 0 &&
    typeof row.description === "string" &&
    typeof row.amount === "string" &&
    typeof row.requestId === "string" &&
    typeof row.touched === "boolean"
  )
}

export function isShoppingReceiptDraft(value: unknown): value is ShoppingReceiptDraftV1 {
  if (typeof value !== "object" || value == null) return false
  const draft = value as ShoppingReceiptDraftV1
  return (
    draft.version === 1 &&
    typeof draft.groupId === "string" &&
    draft.groupId.length > 0 &&
    typeof draft.merchant === "string" &&
    typeof draft.amount === "string" &&
    Array.isArray(draft.rows) &&
    draft.rows.every(isRow)
  )
}

export function loadShoppingReceiptDraft(groupId: string): ShoppingReceiptDraftV1 | null {
  const draft = loadDraft(SHOPPING_RECEIPT_DRAFT_KEY, isShoppingReceiptDraft)
  if (!draft || draft.groupId !== groupId) return null
  return draft
}

export function saveShoppingReceiptDraft(draft: ShoppingReceiptDraftV1): void {
  saveDraft(SHOPPING_RECEIPT_DRAFT_KEY, draft)
}

export function clearShoppingReceiptDraft(): void {
  clearDraft(SHOPPING_RECEIPT_DRAFT_KEY)
}

export function shoppingReceiptAttemptKey(groupId: string): string {
  return `bitbudget-shopping-receipt-attempt-${groupId}-draft`
}

/** Survives a refresh so a retry cannot create a second receipt. */
export interface ShoppingReceiptAttemptV1 {
  version: 1
  groupId: string
  receiptId: string
  operationId: string
  draftRevision: number | null
  finalized: boolean
  checkoffRequestIds: string[]
}

export function isShoppingReceiptAttempt(value: unknown): value is ShoppingReceiptAttemptV1 {
  if (typeof value !== "object" || value == null) return false
  const attempt = value as ShoppingReceiptAttemptV1
  return (
    attempt.version === 1 &&
    typeof attempt.groupId === "string" &&
    attempt.groupId.length > 0 &&
    typeof attempt.receiptId === "string" &&
    attempt.receiptId.length > 0 &&
    typeof attempt.operationId === "string" &&
    attempt.operationId.length > 0 &&
    (attempt.draftRevision === null ||
      (typeof attempt.draftRevision === "number" && Number.isInteger(attempt.draftRevision))) &&
    typeof attempt.finalized === "boolean" &&
    Array.isArray(attempt.checkoffRequestIds) &&
    attempt.checkoffRequestIds.every((id) => typeof id === "string")
  )
}

export function loadShoppingReceiptAttempt(groupId: string): ShoppingReceiptAttemptV1 | null {
  const attempt = loadDraft(shoppingReceiptAttemptKey(groupId), isShoppingReceiptAttempt)
  if (!attempt || attempt.groupId !== groupId) return null
  return attempt
}

export function saveShoppingReceiptAttempt(attempt: ShoppingReceiptAttemptV1): void {
  saveDraftImmediate(shoppingReceiptAttemptKey(attempt.groupId), attempt)
}

export function clearShoppingReceiptAttempt(groupId: string): void {
  clearDraft(shoppingReceiptAttemptKey(groupId))
}
