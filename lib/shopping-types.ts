/**
 * Shared shopping-list types (issue 129).
 * Encrypted payloads stay opaque on the server; these shapes are for clients
 * and for validating decrypted JSON after a successful authenticated decrypt.
 */

export const SHOPPING_PAYLOAD_SCHEMA_VERSION = 1 as const

export const SHOPPING_RECORD_TYPES = [
  "group_metadata",
  "member_alias",
  "list",
  "request",
  "receipt",
  "receipt_snapshot",
  "event",
] as const

export type ShoppingRecordType = (typeof SHOPPING_RECORD_TYPES)[number]

export const SHOPPING_MEMBER_ROLES = ["owner", "member"] as const
export type ShoppingMemberRole = (typeof SHOPPING_MEMBER_ROLES)[number]

export const SHOPPING_MEMBER_STATUSES = ["pending", "active", "removed", "left"] as const
export type ShoppingMemberStatus = (typeof SHOPPING_MEMBER_STATUSES)[number]

export const SHOPPING_GROUP_LIFECYCLES = ["active", "rotation_required", "archived"] as const
export type ShoppingGroupLifecycle = (typeof SHOPPING_GROUP_LIFECYCLES)[number]

export const SHOPPING_INVITE_STATUSES = [
  "pending",
  "requested",
  "approved",
  "expired",
  "revoked",
  "rejected",
] as const
export type ShoppingInviteStatus = (typeof SHOPPING_INVITE_STATUSES)[number]

export const SHOPPING_RECEIPT_STATUSES = ["draft", "finalized"] as const
export type ShoppingReceiptStatus = (typeof SHOPPING_RECEIPT_STATUSES)[number]

export const SHOPPING_EVENT_TYPES = [
  "receipt_finalized",
  "repayment",
  "reversal",
  "replacement",
] as const
export type ShoppingEventType = (typeof SHOPPING_EVENT_TYPES)[number]

export const SHOPPING_POSTING_STATUSES = [
  "posted",
  "skipped",
  "needs_attention",
  "suppressed",
] as const
export type ShoppingPostingStatus = (typeof SHOPPING_POSTING_STATUSES)[number]

export const SHOPPING_ENTRY_KINDS = [
  "own_expense",
  "advance_out",
  "advance_recovery",
  "repayment_expense",
  "prepaid_out",
  "prepaid_in",
  "prepaid_apply",
  "correction",
] as const
export type ShoppingEntryKind = (typeof SHOPPING_ENTRY_KINDS)[number]

/** Authenticated additional data bound into every shared ciphertext. */
export interface ShoppingAad {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  groupId: string
  objectId: string
  keyVersion: number
  revision: number
  recordType: ShoppingRecordType
}

export interface ShoppingGroupMetadataPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  name: string
  /** Optional shared note. Encrypted with the group name; never stored in plaintext. */
  description?: string
}

export interface ShoppingMemberAliasPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  alias: string
}

export interface ShoppingListPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  title: string
  tripClosed: boolean
  notes?: string
}

export interface ShoppingRequestPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  description: string
  requestedQuantity: number
  purchasedQuantity: number
  unit: string
  notes?: string
  checkedOff: boolean
}

export interface ShoppingReceiptLine {
  id: string
  description: string
  quantity: number
  unit: string
  lineAmountCents: number
  unitPriceCents?: number
  confidence?: number
}

export interface ShoppingReceiptPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  merchant: string
  postedOn: string
  currency: "USD"
  subtotalCents: number
  taxCents: number
  discountCents: number
  feeCents: number
  totalCents: number
  lines: ShoppingReceiptLine[]
  splits: ShoppingReceiptSplit[]
  adjustments?: ShoppingReceiptAdjustment[]
}

export interface ShoppingReceiptSplit {
  lineId: string
  requestId: string
  memberId: string
  quantity: number
  cents: number
}

export interface ShoppingReceiptAdjustment {
  id: string
  label: string
  cents: number
}

export interface ShoppingMemberShare {
  memberId: string
  cents: number
}

export interface ShoppingReceiptFinalizedPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  type: "receipt_finalized"
  receiptId: string
  payerMemberId: string
  postedOn: string
  currency: "USD"
  totalCents: number
  shares: ShoppingMemberShare[]
}

export interface ShoppingRepaymentPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  type: "repayment"
  fromMemberId: string
  toMemberId: string
  cents: number
  postedOn: string
  note?: string
  allocations?: Array<{ receiptEventId: string; cents: number }>
}

export interface ShoppingReversalPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  type: "reversal"
  reversesEventId: string
}

export interface ShoppingReplacementPayload {
  schemaVersion: typeof SHOPPING_PAYLOAD_SCHEMA_VERSION
  type: "replacement"
  replacesEventId: string
  inner:
    | Omit<ShoppingReceiptFinalizedPayload, "schemaVersion">
    | Omit<ShoppingRepaymentPayload, "schemaVersion">
}

export type ShoppingEventPayload =
  | ShoppingReceiptFinalizedPayload
  | ShoppingRepaymentPayload
  | ShoppingReversalPayload
  | ShoppingReplacementPayload

export interface ShoppingProjectedEntry {
  entryKey: string
  kind: ShoppingEntryKind
  cents: number
  type: "expense" | "credit"
  postedOn: string
  counterpartMemberId?: string
  sourceEventId: string
  envelopeHint?: "default" | "original_advance"
}

export const SHOPPING_MAX_ACTIVE_MEMBERS = 12
export const SHOPPING_MAX_LISTS_PER_GROUP = 50
export const SHOPPING_MAX_REQUESTS_PER_LIST = 200
export const SHOPPING_MAX_RECEIPT_LINES = 80
export const SHOPPING_MAX_CIPHERTEXT_CHARS = 64_000
export const SHOPPING_MAX_EVENTS_PAGE = 100
export const SHOPPING_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SHOPPING_MAX_INVITES_PER_HOUR = 10
export const SHOPPING_MAX_ALIAS_CHARS = 80
export const SHOPPING_MAX_NAME_CHARS = 80
export const SHOPPING_MAX_DESCRIPTION_CHARS = 280

export function isShoppingRecordType(value: unknown): value is ShoppingRecordType {
  return typeof value === "string" && (SHOPPING_RECORD_TYPES as readonly string[]).includes(value)
}

export function isShoppingEventType(value: unknown): value is ShoppingEventType {
  return typeof value === "string" && (SHOPPING_EVENT_TYPES as readonly string[]).includes(value)
}

export function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128
}
