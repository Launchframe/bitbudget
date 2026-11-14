/**
 * Server-side shopping authorization and mutations.
 * Access is session + active membership, never a body userId.
 */

import { prisma } from "@/lib/db"
import { budgetOptInSequence } from "@/lib/shopping-budget-projection"
import { isShoppingCiphertext, isShoppingKeyFingerprint } from "@/lib/shopping-crypto"
import { generateInviteToken, hashInviteToken } from "@/lib/shopping-invites"
import {
  ShoppingRevisionConflictError,
  ShoppingStaleSequenceError,
  planShoppingEventPage,
  shoppingEventSnapshotWhere,
  shoppingEventWindowStart,
} from "@/lib/shopping-sync"
import {
  SHOPPING_INVITE_HISTORY_CAP,
  SHOPPING_INVITE_HISTORY_MS,
  SHOPPING_INVITE_TTL_MS,
  SHOPPING_MAX_ACTIVE_MEMBERS,
  SHOPPING_MAX_INVITES_PER_HOUR,
  SHOPPING_MAX_LISTS_PER_GROUP,
  SHOPPING_MAX_CIPHERTEXT_CHARS,
  SHOPPING_MAX_REQUESTS_PER_LIST,
  isNonEmptyId,
  isShoppingEventType,
  type ShoppingEventType,
} from "@/lib/shopping-types"

export class ShoppingHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ShoppingHttpError"
  }
}

export function shoppingErrorToResponse(err: unknown): { error: string; status: number } {
  if (err instanceof ShoppingHttpError) return { error: err.message, status: err.status }
  if (err instanceof ShoppingRevisionConflictError) {
    return { error: err.message, status: 409 }
  }
  if (err instanceof ShoppingStaleSequenceError) {
    return { error: err.message, status: 409 }
  }
  throw err
}

function assertCiphertext(value: string, label: string): void {
  if (!isShoppingCiphertext(value)) {
    throw new ShoppingHttpError(`${label} must be encrypted`, 400)
  }
}

export async function requireActiveMember(groupId: string, userId: string) {
  const member = await prisma.shoppingMember.findFirst({
    where: { groupId, userId, status: "active" },
    include: { group: true },
  })
  if (!member) {
    throw new ShoppingHttpError("You do not have access to this list", 404)
  }
  return member
}

export async function requireOwner(groupId: string, userId: string) {
  const member = await requireActiveMember(groupId, userId)
  if (member.role !== "owner") {
    throw new ShoppingHttpError("Only the group owner can do that", 403)
  }
  return member
}

export async function listGroupsForUser(userId: string) {
  const memberships = await prisma.shoppingMember.findMany({
    where: { userId, status: "active" },
    include: {
      group: { include: { members: { select: { status: true } } } },
      keys: { orderBy: { keyVersion: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  })
  return memberships.map((m) => ({
    id: m.group.id,
    keyVersion: m.group.keyVersion,
    membershipRevision: m.group.membershipRevision,
    eventSequence: m.group.eventSequence,
    lifecycle: m.group.lifecycle,
    encryptedMetadata: m.group.encryptedMetadata,
    updatedAt: m.group.updatedAt.toISOString(),
    activeMemberCount: m.group.members.filter((mem) => mem.status === "active").length,
    myMember: {
      id: m.id,
      localId: m.localId,
      role: m.role,
      status: m.status,
      encryptedAlias: m.encryptedAlias,
      pinnedKeyFingerprint: m.pinnedKeyFingerprint,
      historyAccess: m.historyAccess,
    },
    wraps: m.keys.map((k) => ({
      keyVersion: k.keyVersion,
      wrappedKey: k.wrappedKey,
    })),
  }))
}

export async function createGroup(params: {
  userId: string
  encryptedMetadata: string
  encryptedAlias: string
  wrappedKey: string
  pinnedKeyFingerprint: string
  localId: string
  id?: string
}) {
  assertCiphertext(params.encryptedMetadata, "Group name")
  assertCiphertext(params.encryptedAlias, "Your name in this group")
  if (typeof params.wrappedKey !== "string" || params.wrappedKey.length < 40) {
    throw new ShoppingHttpError("Missing wrapped group key", 400)
  }
  if (!isShoppingKeyFingerprint(params.pinnedKeyFingerprint)) {
    throw new ShoppingHttpError("Invalid key fingerprint", 400)
  }
  if (params.id && !isNonEmptyId(params.id)) {
    throw new ShoppingHttpError("Invalid group id", 400)
  }
  return prisma.$transaction(async (tx) => {
    const group = await tx.shoppingGroup.create({
      data: {
        ...(params.id ? { id: params.id } : {}),
        ownerId: params.userId,
        encryptedMetadata: params.encryptedMetadata,
        keyVersion: 1,
        membershipRevision: 1,
        eventSequence: 0,
        lifecycle: "active",
      },
    })
    const member = await tx.shoppingMember.create({
      data: {
        groupId: group.id,
        userId: params.userId,
        localId: params.localId,
        role: "owner",
        status: "active",
        encryptedAlias: params.encryptedAlias,
        pinnedKeyFingerprint: params.pinnedKeyFingerprint,
        historyAccess: true,
      },
    })
    await tx.shoppingMemberKey.create({
      data: {
        groupId: group.id,
        memberId: member.id,
        keyVersion: 1,
        wrappedKey: params.wrappedKey,
      },
    })
    return { group, member }
  })
}

/** Owner snapshot: always include actionable invites; cap recent terminal history. */
export function mergeShoppingOwnerInvites<T extends { id: string; createdAt: Date }>(
  actionable: T[],
  history: T[],
  historyCap = SHOPPING_INVITE_HISTORY_CAP,
): T[] {
  const byId = new Map<string, T>()
  for (const row of actionable) byId.set(row.id, row)
  const capped = [...history]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, historyCap)
  for (const row of capped) {
    if (!byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

async function loadOwnerInvitesForSnapshot(groupId: string) {
  const since = new Date(Date.now() - SHOPPING_INVITE_HISTORY_MS)
  const [actionable, history] = await Promise.all([
    prisma.shoppingInvite.findMany({
      where: { groupId, status: { in: ["pending", "requested"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shoppingInvite.findMany({
      where: {
        groupId,
        status: { in: ["approved", "revoked", "rejected", "expired"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: SHOPPING_INVITE_HISTORY_CAP,
    }),
  ])
  return mergeShoppingOwnerInvites(actionable, history)
}

export async function getGroupSnapshot(groupId: string, userId: string) {
  const me = await requireActiveMember(groupId, userId)
  const eventWindowStart = shoppingEventWindowStart(me.group.eventSequence)
  const [members, lists, requests, receipts, events, myKeys, pendingInvites] = await Promise.all([
    prisma.shoppingMember.findMany({
      where: { groupId, status: { in: ["active", "removed", "left"] } },
      select: {
        id: true,
        localId: true,
        role: true,
        status: true,
        encryptedAlias: true,
        pinnedKeyFingerprint: true,
        historyAccess: true,
        createdAt: true,
      },
    }),
    prisma.shoppingList.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shoppingRequest.findMany({
      where: { groupId, tombstone: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.shoppingReceipt.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shoppingEvent.findMany({
      where: { groupId, ...shoppingEventSnapshotWhere(me.group.eventSequence) },
      orderBy: { sequence: "asc" },
    }),
    prisma.shoppingMemberKey.findMany({
      where: { memberId: me.id },
      orderBy: { keyVersion: "desc" },
    }),
    me.role === "owner" ? loadOwnerInvitesForSnapshot(groupId) : Promise.resolve([]),
  ])

  return {
    group: {
      id: me.group.id,
      keyVersion: me.group.keyVersion,
      membershipRevision: me.group.membershipRevision,
      eventSequence: me.group.eventSequence,
      lifecycle: me.group.lifecycle,
      encryptedMetadata: me.group.encryptedMetadata,
      updatedAt: me.group.updatedAt.toISOString(),
    },
    me: {
      id: me.id,
      localId: me.localId,
      role: me.role,
      status: me.status,
      encryptedAlias: me.encryptedAlias,
      pinnedKeyFingerprint: me.pinnedKeyFingerprint,
      historyAccess: me.historyAccess,
    },
    members,
    wraps: myKeys.map((k) => ({ keyVersion: k.keyVersion, wrappedKey: k.wrappedKey })),
    lists: lists.map(serializeList),
    requests: requests.map(serializeRequest),
    receipts: receipts.map(serializeReceipt),
    events: events.map(serializeEvent),
    eventsMeta: {
      oldestIncludedSequence: events[0]?.sequence ?? null,
      // Earlier rows: GET .../events?beforeSequence=<oldestIncludedSequence>
      hasEarlierEvents: eventWindowStart != null && eventWindowStart > 1,
    },
    invites:
      me.role === "owner"
        ? pendingInvites.map((inv) => ({
            id: inv.id,
            status: inv.status,
            expiresAt: inv.expiresAt.toISOString(),
            verificationCode: inv.verificationCode,
            encryptedClaimantAlias: inv.encryptedClaimantAlias,
            claimantKeyFingerprint: inv.claimantKeyFingerprint,
            createdAt: inv.createdAt.toISOString(),
          }))
        : [],
  }
}

function serializeList(row: {
  id: string
  encryptedPayload: string
  keyVersion: number
  revision: number
  tombstone: boolean
  createdByMemberId: string
  updatedAt: Date
}) {
  return {
    id: row.id,
    encryptedPayload: row.encryptedPayload,
    keyVersion: row.keyVersion,
    revision: row.revision,
    tombstone: row.tombstone,
    createdByMemberId: row.createdByMemberId,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeRequest(row: {
  id: string
  listId: string
  requesterMemberId: string
  authorMemberId: string
  encryptedPayload: string
  keyVersion: number
  revision: number
  tombstone: boolean
  updatedAt: Date
}) {
  return {
    id: row.id,
    listId: row.listId,
    requesterMemberId: row.requesterMemberId,
    authorMemberId: row.authorMemberId,
    encryptedPayload: row.encryptedPayload,
    keyVersion: row.keyVersion,
    revision: row.revision,
    tombstone: row.tombstone,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeReceipt(row: {
  id: string
  listId: string | null
  payerMemberId: string
  encryptedPayload: string
  keyVersion: number
  revision: number
  status: string
  frozenRequestSnapshot: string | null
  finalizedEventId: string | null
  createdByMemberId: string
  updatedAt: Date
}) {
  return {
    id: row.id,
    listId: row.listId,
    payerMemberId: row.payerMemberId,
    encryptedPayload: row.encryptedPayload,
    keyVersion: row.keyVersion,
    revision: row.revision,
    status: row.status,
    frozenRequestSnapshot: row.frozenRequestSnapshot,
    finalizedEventId: row.finalizedEventId,
    createdByMemberId: row.createdByMemberId,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeEvent(row: {
  id: string
  sequence: number
  type: string
  actorMemberId: string
  encryptedPayload: string
  keyVersion: number
  affectedMemberIds: string
  operationId: string
  createdAt: Date
}) {
  return {
    id: row.id,
    sequence: row.sequence,
    type: row.type,
    actorMemberId: row.actorMemberId,
    encryptedPayload: row.encryptedPayload,
    keyVersion: row.keyVersion,
    affectedMemberIds: row.affectedMemberIds,
    operationId: row.operationId,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function createInvite(params: { groupId: string; userId: string }) {
  const owner = await requireOwner(params.groupId, params.userId)
  if (owner.group.lifecycle === "archived") {
    throw new ShoppingHttpError("This group is closed", 409)
  }
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recent = await prisma.shoppingInvite.count({
    where: { createdByUserId: params.userId, createdAt: { gte: hourAgo } },
  })
  if (recent >= SHOPPING_MAX_INVITES_PER_HOUR) {
    throw new ShoppingHttpError("Too many invites. Try again later.", 429)
  }
  const activeCount = await prisma.shoppingMember.count({
    where: { groupId: params.groupId, status: "active" },
  })
  if (activeCount >= SHOPPING_MAX_ACTIVE_MEMBERS) {
    throw new ShoppingHttpError("This group is full", 400)
  }
  const token = generateInviteToken()
  const tokenHash = await hashInviteToken(token)
  const invite = await prisma.shoppingInvite.create({
    data: {
      groupId: params.groupId,
      createdByUserId: params.userId,
      tokenHash,
      status: "pending",
      expiresAt: new Date(Date.now() + SHOPPING_INVITE_TTL_MS),
    },
  })
  const ownerUser = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { publicKey: true },
  })
  return { invite, token, ownerPublicKey: ownerUser?.publicKey ?? null }
}

export async function revokeInvite(params: { groupId: string; userId: string; inviteId: string }) {
  await requireOwner(params.groupId, params.userId)
  const updated = await prisma.shoppingInvite.updateMany({
    where: {
      id: params.inviteId,
      groupId: params.groupId,
      status: { in: ["pending", "requested"] },
    },
    data: { status: "revoked" },
  })
  if (updated.count !== 1) {
    throw new ShoppingHttpError("Invite not found", 404)
  }
}

export async function claimInvite(params: {
  userId: string
  token: string
  publicKey: string
  keyFingerprint: string
  encryptedClaimantAlias: string
  verificationCode: string
}) {
  const tokenHash = await hashInviteToken(params.token)
  const invite = await prisma.shoppingInvite.findUnique({ where: { tokenHash } })
  if (!invite || invite.status === "revoked" || invite.status === "rejected") {
    throw new ShoppingHttpError("This invite is not valid", 404)
  }
  if (invite.expiresAt.getTime() <= Date.now() || invite.status === "expired") {
    throw new ShoppingHttpError("This invite has expired", 410)
  }
  if (invite.status === "approved") {
    throw new ShoppingHttpError("This invite was already used", 409)
  }
  if (invite.createdByUserId === params.userId) {
    throw new ShoppingHttpError("You cannot join your own invite", 400)
  }
  const existing = await prisma.shoppingMember.findFirst({
    where: { groupId: invite.groupId, userId: params.userId, status: "active" },
  })
  if (existing) {
    throw new ShoppingHttpError("You are already in this group", 409)
  }
  if (!params.publicKey || typeof params.publicKey !== "string") {
    throw new ShoppingHttpError("Finish Secure Your Data before joining", 400)
  }
  if (invite.status === "requested" && invite.claimantUserId !== params.userId) {
    throw new ShoppingHttpError("This invite is waiting on another request", 409)
  }
  const updated = await prisma.shoppingInvite.updateMany({
    where: {
      id: invite.id,
      status: { in: ["pending", "requested"] },
      expiresAt: { gt: new Date() },
    },
    data: {
      status: "requested",
      claimantUserId: params.userId,
      claimantPublicKey: params.publicKey,
      claimantKeyFingerprint: params.keyFingerprint,
      encryptedClaimantAlias: params.encryptedClaimantAlias,
      verificationCode: params.verificationCode,
    },
  })
  if (updated.count !== 1) {
    throw new ShoppingHttpError("This invite is no longer available", 409)
  }
  return { requested: true }
}

export async function getClaimantKey(params: { groupId: string; userId: string; inviteId: string }) {
  await requireOwner(params.groupId, params.userId)
  const invite = await prisma.shoppingInvite.findFirst({
    where: { id: params.inviteId, groupId: params.groupId, status: "requested" },
    select: {
      id: true,
      claimantPublicKey: true,
      claimantKeyFingerprint: true,
      encryptedClaimantAlias: true,
      verificationCode: true,
    },
  })
  if (!invite || !invite.claimantPublicKey || !invite.claimantKeyFingerprint) {
    throw new ShoppingHttpError("No pending request", 404)
  }
  return {
    inviteId: invite.id,
    publicKey: invite.claimantPublicKey,
    fingerprint: invite.claimantKeyFingerprint,
    encryptedClaimantAlias: invite.encryptedClaimantAlias,
    verificationCode: invite.verificationCode,
  }
}

export async function approveInvite(params: {
  groupId: string
  userId: string
  inviteId: string
  expectedFingerprint: string
  wrappedKey: string
  encryptedAlias: string
  localId: string
  memberKeyVersion: number
}) {
  const owner = await requireOwner(params.groupId, params.userId)
  return prisma.$transaction(async (tx) => {
    const invite = await tx.shoppingInvite.findFirst({
      where: { id: params.inviteId, groupId: params.groupId },
    })
    if (!invite || invite.status !== "requested" || !invite.claimantUserId) {
      throw new ShoppingHttpError("No pending request", 404)
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new ShoppingHttpError("This invite has expired", 410)
    }
    if (invite.claimantKeyFingerprint !== params.expectedFingerprint) {
      throw new ShoppingHttpError("The requester's key changed. Compare again before approving.", 409)
    }
    const consumed = await tx.shoppingInvite.updateMany({
      where: { id: invite.id, status: "requested" },
      data: { status: "approved" },
    })
    if (consumed.count !== 1) {
      throw new ShoppingHttpError("This invite is no longer available", 409)
    }
    const activeCount = await tx.shoppingMember.count({
      where: { groupId: params.groupId, status: "active" },
    })
    if (activeCount >= SHOPPING_MAX_ACTIVE_MEMBERS) {
      throw new ShoppingHttpError("This group is full", 400)
    }
    const member = await tx.shoppingMember.create({
      data: {
        groupId: params.groupId,
        userId: invite.claimantUserId,
        localId: params.localId,
        role: "member",
        status: "active",
        encryptedAlias: params.encryptedAlias,
        pinnedKeyFingerprint: invite.claimantKeyFingerprint!,
        historyAccess: true,
      },
    })
    await tx.shoppingMemberKey.create({
      data: {
        groupId: params.groupId,
        memberId: member.id,
        keyVersion: params.memberKeyVersion,
        wrappedKey: params.wrappedKey,
      },
    })
    await tx.shoppingGroup.update({
      where: { id: params.groupId },
      data: { membershipRevision: owner.group.membershipRevision + 1 },
    })
    return { memberId: member.id, localId: member.localId }
  })
}

export async function rejectInvite(params: { groupId: string; userId: string; inviteId: string }) {
  await requireOwner(params.groupId, params.userId)
  const updated = await prisma.shoppingInvite.updateMany({
    where: { id: params.inviteId, groupId: params.groupId, status: "requested" },
    data: { status: "rejected" },
  })
  if (updated.count !== 1) throw new ShoppingHttpError("No pending request", 404)
}

export async function removeOrLeaveMember(params: {
  groupId: string
  actorUserId: string
  targetMemberId: string
  leaving: boolean
}) {
  const actor = await requireActiveMember(params.groupId, params.actorUserId)
  const target = await prisma.shoppingMember.findFirst({
    where: { id: params.targetMemberId, groupId: params.groupId, status: "active" },
  })
  if (!target) throw new ShoppingHttpError("Member not found", 404)
  if (!params.leaving && actor.role !== "owner") {
    throw new ShoppingHttpError("Only the group owner can remove someone", 403)
  }
  if (params.leaving && target.userId !== params.actorUserId) {
    throw new ShoppingHttpError("You can only leave your own membership", 403)
  }
  if (target.role === "owner") {
    throw new ShoppingHttpError("Transfer ownership before leaving", 409)
  }
  await prisma.$transaction(async (tx) => {
    await tx.shoppingMember.update({
      where: { id: target.id },
      data: { status: params.leaving ? "left" : "removed" },
    })
    await tx.shoppingGroup.update({
      where: { id: params.groupId },
      data: {
        membershipRevision: actor.group.membershipRevision + 1,
        lifecycle: "rotation_required",
      },
    })
  })
}

/** Every active member gets exactly one wrap, and each wrap is long enough to be a sealed key. */
export function assertWrapsCoverMembers(
  wraps: ReadonlyArray<{ memberId: string; wrappedKey: string }>,
  activeMemberIds: readonly string[],
): void {
  const ids = wraps.map((wrap) => wrap.memberId)
  const unique = new Set(ids)
  if (
    unique.size !== ids.length ||
    unique.size !== activeMemberIds.length ||
    activeMemberIds.some((id) => !unique.has(id))
  ) {
    throw new ShoppingHttpError("Wrap the new key for every remaining member", 400)
  }
  for (const wrap of wraps) {
    if (typeof wrap.wrappedKey !== "string" || wrap.wrappedKey.length < 40) {
      throw new ShoppingHttpError("Missing wrapped group key", 400)
    }
  }
}

type ReencryptedRow = { id?: unknown; encryptedPayload?: unknown; revision?: unknown }

/** Reject plaintext and missing ids before rotation `updateMany` (undefined filters match every row). */
export function assertReencryptedShoppingCiphertext(reencrypted: {
  lists?: readonly ReencryptedRow[]
  requests?: readonly ReencryptedRow[]
  receipts?: readonly ReencryptedRow[]
}): void {
  const check = (rows: unknown, label: string) => {
    if (rows == null) return
    if (!Array.isArray(rows)) throw new ShoppingHttpError("Invalid revision", 400)
    for (const row of rows as ReencryptedRow[]) {
      if (!row || typeof row !== "object" || !isNonEmptyId(row.id)) {
        throw new ShoppingHttpError("Invalid revision", 400)
      }
      if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1) {
        throw new ShoppingHttpError("Invalid revision", 400)
      }
      const payload = typeof row.encryptedPayload === "string" ? row.encryptedPayload : ""
      assertCiphertext(payload, label)
      if (payload.length > SHOPPING_MAX_CIPHERTEXT_CHARS) {
        throw new ShoppingHttpError(`${label} is too large`, 400)
      }
    }
  }
  check(reencrypted.lists, "List")
  check(reencrypted.requests, "Item")
  check(reencrypted.receipts, "Receipt")
}

export async function rotateGroupKeys(params: {
  groupId: string
  userId: string
  nextKeyVersion: number
  encryptedMetadata: string
  wraps: Array<{ memberId: string; fingerprint: string; wrappedKey: string }>
  reencrypted: {
    lists?: Array<{ id: string; encryptedPayload: string; revision: number }>
    requests?: Array<{ id: string; encryptedPayload: string; revision: number }>
    receipts?: Array<{ id: string; encryptedPayload: string; revision: number }>
  }
}) {
  const owner = await requireOwner(params.groupId, params.userId)
  if (params.nextKeyVersion !== owner.group.keyVersion + 1) {
    throw new ShoppingHttpError("Key version is out of date. Refresh and try again.", 409)
  }
  const active = await prisma.shoppingMember.findMany({
    where: { groupId: params.groupId, status: "active" },
  })
  assertWrapsCoverMembers(
    params.wraps,
    active.map((m) => m.id),
  )
  const byId = new Map(active.map((m) => [m.id, m]))
  for (const wrap of params.wraps) {
    const member = byId.get(wrap.memberId)
    if (!member) throw new ShoppingHttpError("Unknown member in key wrap", 400)
    if (member.pinnedKeyFingerprint !== wrap.fingerprint) {
      throw new ShoppingHttpError("A member's key changed. Compare fingerprints again.", 409)
    }
  }
  assertCiphertext(params.encryptedMetadata, "Group name")
  assertReencryptedShoppingCiphertext(params.reencrypted)
  await prisma.$transaction(async (tx) => {
    await tx.shoppingGroup.update({
      where: { id: params.groupId },
      data: {
        keyVersion: params.nextKeyVersion,
        encryptedMetadata: params.encryptedMetadata,
        lifecycle: "active",
        membershipRevision: owner.group.membershipRevision + 1,
      },
    })
    for (const wrap of params.wraps) {
      await tx.shoppingMemberKey.create({
        data: {
          groupId: params.groupId,
          memberId: wrap.memberId,
          keyVersion: params.nextKeyVersion,
          wrappedKey: wrap.wrappedKey,
        },
      })
    }
    for (const list of params.reencrypted.lists ?? []) {
      const updated = await tx.shoppingList.updateMany({
        where: { id: list.id, groupId: params.groupId, revision: list.revision },
        data: {
          encryptedPayload: list.encryptedPayload,
          keyVersion: params.nextKeyVersion,
          revision: list.revision + 1,
        },
      })
      if (updated.count !== 1) throw new ShoppingRevisionConflictError(list.revision)
    }
    for (const request of params.reencrypted.requests ?? []) {
      const updated = await tx.shoppingRequest.updateMany({
        where: { id: request.id, groupId: params.groupId, revision: request.revision },
        data: {
          encryptedPayload: request.encryptedPayload,
          keyVersion: params.nextKeyVersion,
          revision: request.revision + 1,
        },
      })
      if (updated.count !== 1) throw new ShoppingRevisionConflictError(request.revision)
    }
    for (const receipt of params.reencrypted.receipts ?? []) {
      const updated = await tx.shoppingReceipt.updateMany({
        where: { id: receipt.id, groupId: params.groupId, revision: receipt.revision, status: "draft" },
        data: {
          encryptedPayload: receipt.encryptedPayload,
          keyVersion: params.nextKeyVersion,
          revision: receipt.revision + 1,
        },
      })
      if (updated.count !== 1) throw new ShoppingRevisionConflictError(receipt.revision)
    }
  })
}

function assertWritableGroup(lifecycle: string): void {
  if (lifecycle === "archived") {
    throw new ShoppingHttpError("This group is closed", 409)
  }
  if (lifecycle === "rotation_required") {
    throw new ShoppingHttpError("An owner needs to rotate the group key before anyone can make changes", 409)
  }
}

export async function createList(params: {
  groupId: string
  userId: string
  encryptedPayload: string
  keyVersion: number
  id?: string
}) {
  const me = await requireActiveMember(params.groupId, params.userId)
  assertWritableGroup(me.group.lifecycle)
  if (params.keyVersion !== me.group.keyVersion) {
    throw new ShoppingHttpError("This device has an old group key. Refresh and try again.", 409)
  }
  if (params.id && !isNonEmptyId(params.id)) {
    throw new ShoppingHttpError("Invalid list id", 400)
  }
  assertCiphertext(params.encryptedPayload, "List")
  const count = await prisma.shoppingList.count({
    where: { groupId: params.groupId, tombstone: false },
  })
  if (count >= SHOPPING_MAX_LISTS_PER_GROUP) {
    throw new ShoppingHttpError("This group has too many lists", 400)
  }
  return prisma.shoppingList.create({
    data: {
      ...(params.id ? { id: params.id } : {}),
      groupId: params.groupId,
      encryptedPayload: params.encryptedPayload,
      keyVersion: params.keyVersion,
      revision: 1,
      createdByMemberId: me.id,
    },
  })
}

export async function updateList(params: {
  groupId: string
  userId: string
  listId: string
  expectedRevision: number
  encryptedPayload: string
  keyVersion: number
  tombstone?: boolean
}) {
  const me = await requireActiveMember(params.groupId, params.userId)
  assertWritableGroup(me.group.lifecycle)
  if (params.keyVersion !== me.group.keyVersion) {
    throw new ShoppingHttpError("This device has an old group key. Refresh and try again.", 409)
  }
  assertCiphertext(params.encryptedPayload, "List")
  const updated = await prisma.shoppingList.updateMany({
    where: { id: params.listId, groupId: params.groupId, revision: params.expectedRevision },
    data: {
      encryptedPayload: params.encryptedPayload,
      keyVersion: params.keyVersion,
      revision: params.expectedRevision + 1,
      ...(params.tombstone != null ? { tombstone: params.tombstone } : {}),
    },
  })
  if (updated.count !== 1) {
    const current = await prisma.shoppingList.findFirst({
      where: { id: params.listId, groupId: params.groupId },
    })
    throw new ShoppingRevisionConflictError(current?.revision ?? params.expectedRevision)
  }
  return prisma.shoppingList.findFirstOrThrow({ where: { id: params.listId } })
}

export async function createRequest(params: {
  groupId: string
  userId: string
  listId: string
  requesterMemberId: string
  encryptedPayload: string
  keyVersion: number
  id?: string
}) {
  const me = await requireActiveMember(params.groupId, params.userId)
  assertWritableGroup(me.group.lifecycle)
  if (params.keyVersion !== me.group.keyVersion) {
    throw new ShoppingHttpError("This device has an old group key. Refresh and try again.", 409)
  }
  const list = await prisma.shoppingList.findFirst({
    where: { id: params.listId, groupId: params.groupId, tombstone: false },
  })
  if (!list) throw new ShoppingHttpError("List not found", 404)
  const requester = await prisma.shoppingMember.findFirst({
    where: { id: params.requesterMemberId, groupId: params.groupId, status: "active" },
  })
  if (!requester) throw new ShoppingHttpError("Requester is not in this group", 400)
  assertCiphertext(params.encryptedPayload, "Item")
  if (params.id && !isNonEmptyId(params.id)) {
    throw new ShoppingHttpError("Invalid item id", 400)
  }
  const count = await prisma.shoppingRequest.count({
    where: { listId: params.listId, tombstone: false },
  })
  if (count >= SHOPPING_MAX_REQUESTS_PER_LIST) {
    throw new ShoppingHttpError("This list is full", 400)
  }
  return prisma.shoppingRequest.create({
    data: {
      ...(params.id ? { id: params.id } : {}),
      groupId: params.groupId,
      listId: params.listId,
      requesterMemberId: params.requesterMemberId,
      authorMemberId: me.id,
      encryptedPayload: params.encryptedPayload,
      keyVersion: params.keyVersion,
      revision: 1,
    },
  })
}

export async function updateRequest(params: {
  groupId: string
  userId: string
  requestId: string
  expectedRevision: number
  encryptedPayload: string
  keyVersion: number
  tombstone?: boolean
  checkoffOnly?: boolean
}) {
  const me = await requireActiveMember(params.groupId, params.userId)
  assertWritableGroup(me.group.lifecycle)
  if (params.keyVersion !== me.group.keyVersion) {
    throw new ShoppingHttpError("This device has an old group key. Refresh and try again.", 409)
  }
  const existing = await prisma.shoppingRequest.findFirst({
    where: { id: params.requestId, groupId: params.groupId },
  })
  if (!existing) throw new ShoppingHttpError("Item not found", 404)
  if (!params.checkoffOnly) {
    const canEdit =
      existing.requesterMemberId === me.id ||
      existing.authorMemberId === me.id ||
      me.role === "owner"
    if (!canEdit) {
      throw new ShoppingHttpError("You can only edit your own requests", 403)
    }
  }
  assertCiphertext(params.encryptedPayload, "Item")
  const updated = await prisma.shoppingRequest.updateMany({
    where: { id: params.requestId, groupId: params.groupId, revision: params.expectedRevision },
    data: {
      encryptedPayload: params.encryptedPayload,
      keyVersion: params.keyVersion,
      revision: params.expectedRevision + 1,
      ...(params.tombstone != null ? { tombstone: params.tombstone } : {}),
    },
  })
  if (updated.count !== 1) {
    throw new ShoppingRevisionConflictError(existing.revision)
  }
  return prisma.shoppingRequest.findFirstOrThrow({ where: { id: params.requestId } })
}

export async function upsertReceiptDraft(params: {
  groupId: string
  userId: string
  receiptId?: string
  listId?: string | null
  payerMemberId: string
  encryptedPayload: string
  keyVersion: number
  expectedRevision?: number
  frozenRequestSnapshot?: string | null
}) {
  const me = await requireActiveMember(params.groupId, params.userId)
  assertWritableGroup(me.group.lifecycle)
  if (params.keyVersion !== me.group.keyVersion) {
    throw new ShoppingHttpError("This device has an old group key. Refresh and try again.", 409)
  }
  const payer = await prisma.shoppingMember.findFirst({
    where: { id: params.payerMemberId, groupId: params.groupId, status: "active" },
  })
  if (!payer) throw new ShoppingHttpError("Payer is not in this group", 400)
  assertCiphertext(params.encryptedPayload, "Receipt")
  if (params.frozenRequestSnapshot) assertCiphertext(params.frozenRequestSnapshot, "Receipt snapshot")
  if (params.receiptId && !isNonEmptyId(params.receiptId)) {
    throw new ShoppingHttpError("Invalid receipt id", 400)
  }
  if (!params.receiptId) {
    return prisma.shoppingReceipt.create({
      data: {
        groupId: params.groupId,
        listId: params.listId ?? null,
        payerMemberId: params.payerMemberId,
        encryptedPayload: params.encryptedPayload,
        keyVersion: params.keyVersion,
        revision: 1,
        status: "draft",
        frozenRequestSnapshot: params.frozenRequestSnapshot ?? null,
        createdByMemberId: me.id,
      },
    })
  }
  const existing = await prisma.shoppingReceipt.findFirst({
    where: { id: params.receiptId, groupId: params.groupId },
  })
  if (!existing) {
    if (params.expectedRevision != null) {
      throw new ShoppingHttpError("Receipt not found", 404)
    }
    return prisma.shoppingReceipt.create({
      data: {
        id: params.receiptId,
        groupId: params.groupId,
        listId: params.listId ?? null,
        payerMemberId: params.payerMemberId,
        encryptedPayload: params.encryptedPayload,
        keyVersion: params.keyVersion,
        revision: 1,
        status: "draft",
        frozenRequestSnapshot: params.frozenRequestSnapshot ?? null,
        createdByMemberId: me.id,
      },
    })
  }
  if (existing.status === "finalized") {
    throw new ShoppingHttpError("This receipt is already finalized", 409)
  }
  const expected = params.expectedRevision ?? existing.revision
  const updated = await prisma.shoppingReceipt.updateMany({
    where: { id: existing.id, revision: expected, status: "draft" },
    data: {
      encryptedPayload: params.encryptedPayload,
      keyVersion: params.keyVersion,
      revision: expected + 1,
      payerMemberId: params.payerMemberId,
      listId: params.listId ?? existing.listId,
      frozenRequestSnapshot: params.frozenRequestSnapshot ?? existing.frozenRequestSnapshot,
    },
  })
  if (updated.count !== 1) throw new ShoppingRevisionConflictError(existing.revision)
  return prisma.shoppingReceipt.findFirstOrThrow({ where: { id: existing.id } })
}

export async function listShoppingEvents(params: {
  groupId: string
  userId: string
  afterSequence?: number | null
  beforeSequence?: number | null
  limit?: number
}) {
  await requireActiveMember(params.groupId, params.userId)
  const plan = planShoppingEventPage({
    afterSequence: params.afterSequence ?? null,
    beforeSequence: params.beforeSequence ?? null,
    pageSize: params.limit,
  })
  if (!plan.ok) {
    throw new ShoppingHttpError(
      plan.reason === "both"
        ? "Choose either newer or earlier items, not both."
        : "Invalid sequence cursor",
      400,
    )
  }
  const rows = await prisma.shoppingEvent.findMany({
    where: { groupId: params.groupId, sequence: plan.sequence },
    orderBy: { sequence: plan.order },
    take: plan.take,
  })
  const hasMore = rows.length > plan.pageSize
  const page = hasMore ? rows.slice(0, plan.pageSize) : rows
  const ordered = plan.reverse ? page.reverse() : page
  return { events: ordered.map(serializeEvent), hasMore }
}

export async function appendShoppingEvent(params: {
  groupId: string
  userId: string
  expectedSequence: number
  type: ShoppingEventType
  encryptedPayload: string
  keyVersion: number
  operationId: string
  affectedMemberIds: string[]
  receiptId?: string
  payerMemberId?: string
}) {
  const me = await requireActiveMember(params.groupId, params.userId)
  assertWritableGroup(me.group.lifecycle)
  if (params.keyVersion !== me.group.keyVersion) {
    throw new ShoppingHttpError("This device has an old group key. Refresh and try again.", 409)
  }
  if (!isShoppingEventType(params.type)) {
    throw new ShoppingHttpError("Unknown event type", 400)
  }
  if (!params.operationId || params.operationId.length > 128) {
    throw new ShoppingHttpError("Missing operation id", 400)
  }
  assertCiphertext(params.encryptedPayload, "Event")

  const existingOp = await prisma.shoppingEvent.findFirst({
    where: { groupId: params.groupId, operationId: params.operationId },
  })
  if (existingOp) return { event: existingOp, idempotent: true }

  if (params.type === "receipt_finalized") {
    if (!params.receiptId || !params.payerMemberId) {
      throw new ShoppingHttpError("Receipt and payer are required", 400)
    }
    if (params.payerMemberId !== me.id) {
      throw new ShoppingHttpError("Only the person who paid can finalize this receipt", 403)
    }
  }

  return prisma.$transaction(async (tx) => {
    const bumped = await tx.shoppingGroup.updateMany({
      where: {
        id: params.groupId,
        eventSequence: params.expectedSequence,
        lifecycle: "active",
      },
      data: { eventSequence: params.expectedSequence + 1 },
    })
    if (bumped.count !== 1) {
      throw new ShoppingStaleSequenceError(me.group.eventSequence)
    }
    const event = await tx.shoppingEvent.create({
      data: {
        groupId: params.groupId,
        sequence: params.expectedSequence + 1,
        type: params.type,
        actorMemberId: me.id,
        encryptedPayload: params.encryptedPayload,
        keyVersion: params.keyVersion,
        affectedMemberIds: JSON.stringify(params.affectedMemberIds),
        operationId: params.operationId,
      },
    })
    if (params.type === "receipt_finalized" && params.receiptId) {
      const finalized = await tx.shoppingReceipt.updateMany({
        where: {
          id: params.receiptId,
          groupId: params.groupId,
          status: "draft",
          payerMemberId: me.id,
        },
        data: { status: "finalized", finalizedEventId: event.id },
      })
      if (finalized.count !== 1) {
        throw new ShoppingHttpError("This receipt cannot be finalized", 409)
      }
    }
    return { event, idempotent: false }
  })
}

export async function getOrCreatePreference(groupId: string, userId: string) {
  await requireActiveMember(groupId, userId)
  return prisma.shoppingBudgetPreference.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {},
    create: { groupId, userId, enabled: false, preferenceVersion: 1 },
  })
}

export async function updatePreference(params: {
  groupId: string
  userId: string
  expectedVersion: number
  enabled: boolean
  envelopeId: string | null
  catchUpApproved?: boolean
}) {
  await requireActiveMember(params.groupId, params.userId)
  if (params.enabled) {
    if (!params.envelopeId) {
      throw new ShoppingHttpError("Choose one of your envelopes", 400)
    }
    const envelope = await prisma.envelope.findFirst({
      where: {
        id: params.envelopeId,
        userId: params.userId,
        deletedAt: null,
        archived: false,
        systemRole: null,
      },
    })
    if (!envelope) throw new ShoppingHttpError("Choose one of your envelopes", 400)
  }
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ eventSequence: number }>>`
      SELECT "eventSequence" FROM "ShoppingGroup" WHERE "id" = ${params.groupId} FOR UPDATE
    `
    const groupEventSequence = locked[0]?.eventSequence
    if (groupEventSequence == null) {
      throw new ShoppingHttpError("You do not have access to this list", 404)
    }
    const current = await tx.shoppingBudgetPreference.findFirst({
      where: { groupId: params.groupId, userId: params.userId },
    })
    if (!current || current.preferenceVersion !== params.expectedVersion) {
      throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
    }
    const catchUpApproved = params.enabled && params.catchUpApproved === true
    const enabledAtSequence = budgetOptInSequence({
      enabled: params.enabled,
      catchUpApproved,
      previouslyEnabled: current.enabled,
      previousCatchUpApproved: current.catchUpApproved,
      previousEnabledAtSequence: current.enabledAtSequence,
      groupEventSequence,
    })
    const updated = await tx.shoppingBudgetPreference.updateMany({
      where: {
        groupId: params.groupId,
        userId: params.userId,
        preferenceVersion: params.expectedVersion,
      },
      data: {
        enabled: params.enabled,
        envelopeId: params.enabled ? params.envelopeId : current.envelopeId,
        catchUpApproved,
        enabledAtSequence,
        preferenceVersion: params.expectedVersion + 1,
      },
    })
    if (updated.count !== 1) {
      throw new ShoppingHttpError("Budget settings changed on another device. Refresh and try again.", 409)
    }
    return tx.shoppingBudgetPreference.findFirstOrThrow({
      where: { groupId: params.groupId, userId: params.userId },
    })
  })
}

export async function handleAccountDeletion(userId: string): Promise<void> {
  const owned = await prisma.shoppingGroup.findMany({
    where: { ownerId: userId },
    include: { members: { where: { status: "active" } } },
  })
  for (const group of owned) {
    const successor = group.members.find((m) => m.userId && m.userId !== userId)
    if (successor?.userId) {
      await prisma.$transaction([
        prisma.shoppingGroup.update({
          where: { id: group.id },
          data: {
            ownerId: successor.userId,
            lifecycle: "rotation_required",
            membershipRevision: group.membershipRevision + 1,
          },
        }),
        prisma.shoppingMember.update({
          where: { id: successor.id },
          data: { role: "owner" },
        }),
      ])
    } else {
      await prisma.shoppingGroup.delete({ where: { id: group.id } })
    }
  }

  await prisma.shoppingInvite.updateMany({
    where: {
      OR: [{ createdByUserId: userId }, { claimantUserId: userId }],
      status: { in: ["pending", "requested"] },
    },
    data: { status: "revoked" },
  })

  const leftover = await prisma.shoppingMember.findMany({
    where: { userId, status: "active" },
    select: { id: true, groupId: true },
  })
  for (const row of leftover) {
    await prisma.$transaction([
      prisma.shoppingMember.update({
        where: { id: row.id },
        data: { status: "left", userId: null },
      }),
      prisma.shoppingGroup.update({
        where: { id: row.groupId },
        data: { lifecycle: "rotation_required" },
      }),
    ])
  }

  await prisma.shoppingMember.updateMany({
    where: { userId },
    data: { userId: null },
  })
}
