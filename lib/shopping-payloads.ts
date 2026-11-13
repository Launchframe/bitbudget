/**
 * Client-side parse/build for decrypted shopping JSON.
 * The server never sees these fields; fail closed on malformed plaintext.
 */

import {
  decryptShoppingPayload,
  encryptShoppingPayload,
  parseJsonObject,
} from "@/lib/shopping-crypto"
import {
  SHOPPING_MAX_ALIAS_CHARS,
  SHOPPING_MAX_DESCRIPTION_CHARS,
  SHOPPING_MAX_NAME_CHARS,
  SHOPPING_PAYLOAD_SCHEMA_VERSION,
  type ShoppingAad,
  type ShoppingGroupMetadataPayload,
  type ShoppingListPayload,
  type ShoppingMemberAliasPayload,
  type ShoppingReceiptPayload,
  type ShoppingRecordType,
  type ShoppingRequestPayload,
} from "@/lib/shopping-types"

export class ShoppingPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShoppingPayloadError"
  }
}

export function newShoppingObjectId(): string {
  return crypto.randomUUID()
}

export function shoppingAad(params: {
  groupId: string
  objectId: string
  keyVersion: number
  revision: number
  recordType: ShoppingRecordType
}): ShoppingAad {
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    groupId: params.groupId,
    objectId: params.objectId,
    keyVersion: params.keyVersion,
    revision: params.revision,
    recordType: params.recordType,
  }
}

function requireTrimmed(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") {
    throw new ShoppingPayloadError(`${label} is required`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new ShoppingPayloadError(`${label} is required`)
  }
  if (trimmed.length > max) {
    throw new ShoppingPayloadError(`${label} is too long`)
  }
  return trimmed
}

function optionalTrimmed(value: unknown, label: string, max: number): string | undefined {
  if (value == null || value === "") return undefined
  if (typeof value !== "string") {
    throw new ShoppingPayloadError(`${label} is invalid`)
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > max) {
    throw new ShoppingPayloadError(`${label} is too long`)
  }
  return trimmed
}

export function parseGroupMetadata(raw: Record<string, unknown>): ShoppingGroupMetadataPayload {
  const name = requireTrimmed(raw.name, "Group name", SHOPPING_MAX_NAME_CHARS)
  const description = optionalTrimmed(raw.description, "Description", SHOPPING_MAX_DESCRIPTION_CHARS)
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    name,
    ...(description ? { description } : {}),
  }
}

export function buildGroupMetadata(name: string, description?: string): ShoppingGroupMetadataPayload {
  return parseGroupMetadata({
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    name,
    description,
  })
}

export function parseMemberAlias(raw: Record<string, unknown>): ShoppingMemberAliasPayload {
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    alias: requireTrimmed(raw.alias, "Name in this group", SHOPPING_MAX_ALIAS_CHARS),
  }
}

export function parseListPayload(raw: Record<string, unknown>): ShoppingListPayload {
  const notes = optionalTrimmed(raw.notes, "Notes", SHOPPING_MAX_DESCRIPTION_CHARS)
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    title: requireTrimmed(raw.title, "List name", SHOPPING_MAX_NAME_CHARS),
    tripClosed: raw.tripClosed === true,
    ...(notes ? { notes } : {}),
  }
}

export function parseRequestPayload(raw: Record<string, unknown>): ShoppingRequestPayload {
  const requestedQuantity =
    typeof raw.requestedQuantity === "number" && Number.isFinite(raw.requestedQuantity)
      ? raw.requestedQuantity
      : 1
  const purchasedQuantity =
    typeof raw.purchasedQuantity === "number" && Number.isFinite(raw.purchasedQuantity)
      ? raw.purchasedQuantity
      : 0
  if (requestedQuantity < 0 || purchasedQuantity < 0) {
    throw new ShoppingPayloadError("Quantity cannot be negative")
  }
  const notes = optionalTrimmed(raw.notes, "Note", SHOPPING_MAX_DESCRIPTION_CHARS)
  const unit = optionalTrimmed(raw.unit, "Unit", 40) ?? ""
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    description: requireTrimmed(raw.description, "Item", SHOPPING_MAX_NAME_CHARS),
    requestedQuantity,
    purchasedQuantity,
    unit,
    checkedOff: raw.checkedOff === true,
    ...(notes ? { notes } : {}),
  }
}

export function parseReceiptPayload(raw: Record<string, unknown>): Pick<
  ShoppingReceiptPayload,
  "schemaVersion" | "merchant" | "postedOn" | "currency" | "totalCents"
> {
  const totalCents = raw.totalCents
  if (typeof totalCents !== "number" || !Number.isInteger(totalCents) || totalCents < 0) {
    throw new ShoppingPayloadError("Receipt total must be a whole-cent amount")
  }
  const postedOn = requireTrimmed(raw.postedOn, "Date", 32)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postedOn)) {
    throw new ShoppingPayloadError("Date must be YYYY-MM-DD")
  }
  return {
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    merchant: requireTrimmed(raw.merchant, "Store", SHOPPING_MAX_NAME_CHARS),
    postedOn,
    currency: "USD",
    totalCents,
  }
}

export async function encryptShoppingJson(
  payload: object,
  groupKey: Uint8Array,
  aad: ShoppingAad,
): Promise<string> {
  return encryptShoppingPayload(JSON.stringify(payload), groupKey, aad)
}

export async function decryptShoppingJson(
  ciphertext: string,
  groupKey: Uint8Array,
  aad: ShoppingAad,
): Promise<Record<string, unknown>> {
  const text = await decryptShoppingPayload(ciphertext, groupKey, aad)
  return parseJsonObject(text)
}

export function aliasInitials(alias: string): string {
  const parts = alias.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return (parts[0]!.slice(0, 1) + parts[1]!.slice(0, 1)).toUpperCase()
}

export function centsToUsdLabel(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

export function dollarsToCents(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[$,]/g, "").trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function formatShoppingUpdatedAt(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return "Updated recently"
  const deltaMin = Math.max(0, Math.round((Date.now() - t) / 60_000))
  if (deltaMin < 1) return "Updated just now"
  if (deltaMin < 60) return `Updated ${deltaMin} min ago`
  const hours = Math.round(deltaMin / 60)
  if (hours < 24) return `Updated ${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "Updated yesterday"
  if (days < 7) return `Updated ${days} days ago`
  return `Updated ${new Date(t).toLocaleDateString()}`
}
