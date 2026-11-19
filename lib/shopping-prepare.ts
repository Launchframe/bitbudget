/**
 * Client builders for shopping create/update ciphertext (unlocked only).
 */

import {
  decryptFieldAsymmetric,
  generateKeyPairFromSeed,
  hexToPublicKey,
  publicKeyToHex,
} from "@/lib/crypto"
import {
  generateGroupContentKey,
  publicKeyFingerprint,
  wrapGroupContentKey,
} from "@/lib/shopping-crypto"
import {
  buildGroupMetadata,
  encryptShoppingJson,
  newShoppingObjectId,
  parseListPayload,
  parseMemberAlias,
  parseReceiptPayload,
  parseRequestPayload,
  shoppingAad,
} from "@/lib/shopping-payloads"
import { SHOPPING_PAYLOAD_SCHEMA_VERSION } from "@/lib/shopping-types"

export async function prepareCreateGroup(params: {
  privacyKey: Uint8Array
  name: string
  description?: string
  alias: string
}): Promise<{
  groupId: string
  localId: string
  groupKey: Uint8Array
  keyVersion: number
  body: Record<string, unknown>
}> {
  const groupId = newShoppingObjectId()
  const localId = newShoppingObjectId()
  const groupKey = generateGroupContentKey()
  const { publicKey } = generateKeyPairFromSeed(params.privacyKey)
  const keyVersion = 1
  const metadata = buildGroupMetadata(params.name, params.description)
  const alias = parseMemberAlias({ schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION, alias: params.alias })
  const encryptedMetadata = await encryptShoppingJson(
    metadata,
    groupKey,
    shoppingAad({
      groupId,
      objectId: groupId,
      keyVersion,
      revision: 1,
      recordType: "group_metadata",
    }),
  )
  const encryptedAlias = await encryptShoppingJson(
    alias,
    groupKey,
    shoppingAad({
      groupId,
      objectId: localId,
      keyVersion,
      revision: 1,
      recordType: "member_alias",
    }),
  )
  return {
    groupId,
    localId,
    groupKey,
    keyVersion,
    body: {
      id: groupId,
      localId,
      encryptedMetadata,
      encryptedAlias,
      wrappedKey: wrapGroupContentKey(groupKey, publicKey),
      pinnedKeyFingerprint: await publicKeyFingerprint(publicKeyToHex(publicKey)),
    },
  }
}

export async function prepareDefaultList(params: {
  groupId: string
  groupKey: Uint8Array
  keyVersion: number
}): Promise<{ id: string; encryptedPayload: string; keyVersion: number }> {
  const id = newShoppingObjectId()
  const payload = parseListPayload({
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    title: "Current trip",
    tripClosed: false,
  })
  const encryptedPayload = await encryptShoppingJson(
    payload,
    params.groupKey,
    shoppingAad({
      groupId: params.groupId,
      objectId: id,
      keyVersion: params.keyVersion,
      revision: 1,
      recordType: "list",
    }),
  )
  return { id, encryptedPayload, keyVersion: params.keyVersion }
}

export async function prepareRequest(params: {
  groupId: string
  groupKey: Uint8Array
  keyVersion: number
  revision: number
  requestId: string
  description: string
  notes?: string
  unit?: string
  requestedQuantity?: number
  purchasedQuantity?: number
  checkedOff?: boolean
}): Promise<string> {
  const payload = parseRequestPayload({
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    description: params.description,
    notes: params.notes,
    unit: params.unit ?? "",
    requestedQuantity: params.requestedQuantity ?? 1,
    purchasedQuantity: params.purchasedQuantity ?? 0,
    checkedOff: params.checkedOff === true,
  })
  return encryptShoppingJson(
    payload,
    params.groupKey,
    shoppingAad({
      groupId: params.groupId,
      objectId: params.requestId,
      keyVersion: params.keyVersion,
      revision: params.revision,
      recordType: "request",
    }),
  )
}

export async function prepareReceiptDraft(params: {
  groupId: string
  groupKey: Uint8Array
  keyVersion: number
  revision: number
  receiptId: string
  merchant: string
  postedOn: string
  totalCents: number
}): Promise<string> {
  const payload = parseReceiptPayload({
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    merchant: params.merchant,
    postedOn: params.postedOn,
    currency: "USD",
    totalCents: params.totalCents,
    subtotalCents: params.totalCents,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    lines: [],
    splits: [],
  })
  return encryptShoppingJson(
    payload,
    params.groupKey,
    shoppingAad({
      groupId: params.groupId,
      objectId: params.receiptId,
      keyVersion: params.keyVersion,
      revision: params.revision,
      recordType: "receipt",
    }),
  )
}

/** Claimant alias is sealed to the owner's key, not the group key. */
export function decryptClaimantAlias(ciphertext: string, privacyKey: Uint8Array): string {
  const { secretKey } = generateKeyPairFromSeed(privacyKey)
  const alias = decryptFieldAsymmetric(ciphertext, secretKey).trim()
  if (!alias) throw new Error("Name is missing")
  return alias
}

/** Re-encrypt the alias for the group and wrap the content key to the requester. */
export async function prepareApproveMember(params: {
  groupId: string
  groupKey: Uint8Array
  keyVersion: number
  claimantPublicKeyHex: string
  alias: string
}): Promise<{
  localId: string
  encryptedAlias: string
  wrappedKey: string
  memberKeyVersion: number
}> {
  const localId = newShoppingObjectId()
  const alias = parseMemberAlias({
    schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
    alias: params.alias,
  })
  const encryptedAlias = await encryptShoppingJson(
    alias,
    params.groupKey,
    shoppingAad({
      groupId: params.groupId,
      objectId: localId,
      keyVersion: params.keyVersion,
      revision: 1,
      recordType: "member_alias",
    }),
  )
  return {
    localId,
    encryptedAlias,
    wrappedKey: wrapGroupContentKey(params.groupKey, hexToPublicKey(params.claimantPublicKeyHex)),
    memberKeyVersion: params.keyVersion,
  }
}

export async function prepareEventPayload(params: {
  groupId: string
  groupKey: Uint8Array
  keyVersion: number
  operationId: string
  payload: object
}): Promise<string> {
  return encryptShoppingJson(
    params.payload,
    params.groupKey,
    shoppingAad({
      groupId: params.groupId,
      objectId: params.operationId,
      keyVersion: params.keyVersion,
      revision: 1,
      recordType: "event",
    }),
  )
}
