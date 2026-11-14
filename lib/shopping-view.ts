/**
 * Decrypt a shopping group snapshot on the unlocked client.
 * Ciphertext stays opaque until the privacy key unwraps the group content key.
 */

import { generateKeyPairFromSeed } from "@/lib/crypto"
import { unwrapGroupContentKey } from "@/lib/shopping-crypto"
import { parseShoppingEventPayload } from "@/lib/shopping-event-validation"
import { amountOwed, reduceShoppingTab, type ShoppingLedgerEvent } from "@/lib/shopping-ledger"
import {
  aliasInitials,
  decryptShoppingJson,
  parseGroupMetadata,
  parseListPayload,
  parseMemberAlias,
  parseReceiptPayload,
  parseRequestPayload,
  shoppingAad,
} from "@/lib/shopping-payloads"
import type { ShoppingEventPayload } from "@/lib/shopping-types"

export interface ShoppingSnapshotMember {
  id: string
  localId: string
  role: string
  status: string
  encryptedAlias: string
  pinnedKeyFingerprint: string
}

export interface ShoppingSnapshotList {
  id: string
  encryptedPayload: string
  keyVersion: number
  revision: number
  tombstone: boolean
  createdByMemberId: string
  updatedAt: string
}

export interface ShoppingSnapshotRequest {
  id: string
  listId: string
  requesterMemberId: string
  authorMemberId: string
  encryptedPayload: string
  keyVersion: number
  revision: number
  tombstone: boolean
  updatedAt: string
}

export interface ShoppingSnapshotReceipt {
  id: string
  listId: string | null
  payerMemberId: string
  encryptedPayload: string
  keyVersion: number
  revision: number
  status: string
  createdByMemberId: string
  updatedAt: string
}

export interface ShoppingSnapshotEvent {
  id: string
  sequence: number
  type: string
  actorMemberId: string
  encryptedPayload: string
  keyVersion: number
  operationId: string
  createdAt: string
}

export interface ShoppingSnapshotInvite {
  id: string
  status: string
  expiresAt: string
  createdAt: string
  verificationCode: string | null
  encryptedClaimantAlias: string | null
  claimantKeyFingerprint: string | null
}

export interface ShoppingSnapshotEventsMeta {
  oldestIncludedSequence: number | null
  hasEarlierEvents: boolean
}

export interface ShoppingGroupSnapshot {
  group: {
    id: string
    keyVersion: number
    membershipRevision: number
    eventSequence: number
    lifecycle: string
    encryptedMetadata: string
    updatedAt: string
  }
  me: {
    id: string
    localId: string
    role: string
    status: string
    encryptedAlias: string
    pinnedKeyFingerprint: string
  }
  members: ShoppingSnapshotMember[]
  wraps: Array<{ keyVersion: number; wrappedKey: string }>
  lists: ShoppingSnapshotList[]
  requests: ShoppingSnapshotRequest[]
  receipts: ShoppingSnapshotReceipt[]
  events: ShoppingSnapshotEvent[]
  eventsMeta?: ShoppingSnapshotEventsMeta
  invites: ShoppingSnapshotInvite[]
}

export interface DecryptedMember {
  id: string
  localId: string
  role: string
  status: string
  alias: string
  initials: string
  fingerprint: string
}

export interface DecryptedRequest {
  id: string
  listId: string
  requesterMemberId: string
  authorMemberId: string
  revision: number
  keyVersion: number
  description: string
  requestedQuantity: number
  purchasedQuantity: number
  unit: string
  notes?: string
  checkedOff: boolean
}

export interface DecryptedList {
  id: string
  revision: number
  keyVersion: number
  title: string
  tripClosed: boolean
  notes?: string
}

export interface DecryptedReceipt {
  id: string
  payerMemberId: string
  status: string
  revision: number
  keyVersion: number
  merchant: string
  postedOn: string
  totalCents: number
}

export interface DecryptedGroupView {
  groupId: string
  keyVersion: number
  eventSequence: number
  lifecycle: string
  updatedAt: string
  name: string
  description?: string
  me: DecryptedMember
  members: DecryptedMember[]
  lists: DecryptedList[]
  requests: DecryptedRequest[]
  receipts: DecryptedReceipt[]
  events: ShoppingLedgerEvent[]
  invites: ShoppingSnapshotInvite[]
  groupKey: Uint8Array
}

export function unwrapCurrentGroupKey(
  wraps: Array<{ keyVersion: number; wrappedKey: string }>,
  keyVersion: number,
  privacyKey: Uint8Array,
): Uint8Array {
  const wrap = wraps.find((row) => row.keyVersion === keyVersion) ?? wraps[0]
  if (!wrap) {
    throw new Error("Missing wrapped group key")
  }
  const { secretKey } = generateKeyPairFromSeed(privacyKey)
  return unwrapGroupContentKey(wrap.wrappedKey, secretKey)
}

export async function decryptGroupSnapshot(
  snapshot: ShoppingGroupSnapshot,
  privacyKey: Uint8Array,
): Promise<DecryptedGroupView> {
  const groupKey = unwrapCurrentGroupKey(snapshot.wraps, snapshot.group.keyVersion, privacyKey)
  const kv = snapshot.group.keyVersion
  const metaRaw = await decryptShoppingJson(
    snapshot.group.encryptedMetadata,
    groupKey,
    shoppingAad({
      groupId: snapshot.group.id,
      objectId: snapshot.group.id,
      keyVersion: kv,
      revision: 1,
      recordType: "group_metadata",
    }),
  )
  const meta = parseGroupMetadata(metaRaw)

  const members: DecryptedMember[] = []
  for (const member of snapshot.members) {
    if (member.status !== "active") continue
    try {
      const raw = await decryptShoppingJson(
        member.encryptedAlias,
        groupKey,
        shoppingAad({
          groupId: snapshot.group.id,
          objectId: member.localId,
          keyVersion: kv,
          revision: 1,
          recordType: "member_alias",
        }),
      )
      const parsed = parseMemberAlias(raw)
      members.push({
        id: member.id,
        localId: member.localId,
        role: member.role,
        status: member.status,
        alias: parsed.alias,
        initials: aliasInitials(parsed.alias),
        fingerprint: member.pinnedKeyFingerprint,
      })
    } catch {
      members.push({
        id: member.id,
        localId: member.localId,
        role: member.role,
        status: member.status,
        alias: "Member",
        initials: "?",
        fingerprint: member.pinnedKeyFingerprint,
      })
    }
  }

  const meRow = members.find((m) => m.id === snapshot.me.id)
  const me =
    meRow ??
    ({
      id: snapshot.me.id,
      localId: snapshot.me.localId,
      role: snapshot.me.role,
      status: snapshot.me.status,
      alias: "You",
      initials: "Y",
      fingerprint: snapshot.me.pinnedKeyFingerprint,
    } satisfies DecryptedMember)

  const lists: DecryptedList[] = []
  for (const list of snapshot.lists) {
    if (list.tombstone) continue
    try {
      const raw = await decryptShoppingJson(
        list.encryptedPayload,
        groupKey,
        shoppingAad({
          groupId: snapshot.group.id,
          objectId: list.id,
          keyVersion: list.keyVersion,
          revision: list.revision,
          recordType: "list",
        }),
      )
      const parsed = parseListPayload(raw)
      lists.push({
        id: list.id,
        revision: list.revision,
        keyVersion: list.keyVersion,
        title: parsed.title,
        tripClosed: parsed.tripClosed,
        notes: parsed.notes,
      })
    } catch {
      /* skip unreadable lists */
    }
  }

  const requests: DecryptedRequest[] = []
  for (const req of snapshot.requests) {
    if (req.tombstone) continue
    try {
      const raw = await decryptShoppingJson(
        req.encryptedPayload,
        groupKey,
        shoppingAad({
          groupId: snapshot.group.id,
          objectId: req.id,
          keyVersion: req.keyVersion,
          revision: req.revision,
          recordType: "request",
        }),
      )
      const parsed = parseRequestPayload(raw)
      requests.push({
        id: req.id,
        listId: req.listId,
        requesterMemberId: req.requesterMemberId,
        authorMemberId: req.authorMemberId,
        revision: req.revision,
        keyVersion: req.keyVersion,
        description: parsed.description,
        requestedQuantity: parsed.requestedQuantity,
        purchasedQuantity: parsed.purchasedQuantity,
        unit: parsed.unit,
        notes: parsed.notes,
        checkedOff: parsed.checkedOff,
      })
    } catch {
      /* skip unreadable items */
    }
  }

  const receipts: DecryptedReceipt[] = []
  for (const receipt of snapshot.receipts) {
    try {
      const raw = await decryptShoppingJson(
        receipt.encryptedPayload,
        groupKey,
        shoppingAad({
          groupId: snapshot.group.id,
          objectId: receipt.id,
          keyVersion: receipt.keyVersion,
          revision: receipt.revision,
          recordType: "receipt",
        }),
      )
      const parsed = parseReceiptPayload(raw)
      receipts.push({
        id: receipt.id,
        payerMemberId: receipt.payerMemberId,
        status: receipt.status,
        revision: receipt.revision,
        keyVersion: receipt.keyVersion,
        merchant: parsed.merchant,
        postedOn: parsed.postedOn,
        totalCents: parsed.totalCents,
      })
    } catch {
      /* skip */
    }
  }

  const events: ShoppingLedgerEvent[] = []
  for (const event of snapshot.events) {
    try {
      const raw = await decryptShoppingJson(
        event.encryptedPayload,
        groupKey,
        shoppingAad({
          groupId: snapshot.group.id,
          objectId: event.operationId,
          keyVersion: event.keyVersion,
          revision: 1,
          recordType: "event",
        }),
      )
      const payload: ShoppingEventPayload = parseShoppingEventPayload(raw)
      events.push({
        id: event.id,
        sequence: event.sequence,
        actorMemberId: event.actorMemberId,
        payload,
      })
    } catch {
      /* skip unreadable events */
    }
  }

  return {
    groupId: snapshot.group.id,
    keyVersion: snapshot.group.keyVersion,
    eventSequence: snapshot.group.eventSequence,
    lifecycle: snapshot.group.lifecycle,
    updatedAt: snapshot.group.updatedAt,
    name: meta.name,
    description: meta.description,
    me,
    members,
    lists,
    requests,
    receipts,
    events,
    invites: snapshot.invites,
    groupKey,
  }
}

export function tabSummaryForMember(
  view: DecryptedGroupView,
  memberId: string,
): { owedToMeCents: number; iOweCents: number } {
  const tab = reduceShoppingTab(view.events)
  let owedToMeCents = 0
  let iOweCents = 0
  for (const other of view.members) {
    if (other.id === memberId) continue
    owedToMeCents += amountOwed(tab, other.id, memberId)
    iOweCents += amountOwed(tab, memberId, other.id)
  }
  return { owedToMeCents, iOweCents }
}

export function memberAlias(view: DecryptedGroupView, memberId: string): string {
  return view.members.find((m) => m.id === memberId)?.alias ?? "Member"
}
