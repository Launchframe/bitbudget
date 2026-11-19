"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  enqueueShoppingOutbox,
  listShoppingOutbox,
  removeShoppingOutboxItem,
  saveShoppingSnapshot,
} from "@/lib/shopping-cache"
import {
  clearPendingShoppingInvite,
  loadPendingShoppingInvite,
} from "@/lib/shopping-invite-handoff"
import { isRequestVerificationCode } from "@/lib/shopping-invites"
import { canQueueOffline, type ShoppingOutboxItem } from "@/lib/shopping-sync"
import { encryptFieldAsymmetric, hexToPublicKey } from "@/lib/crypto"
import {
  ShoppingSnapshotSupersededError,
  loadCompleteShoppingSnapshotEvents,
} from "@/lib/shopping-snapshot-events"
import type { ShoppingGroupSnapshot, ShoppingSnapshotEvent } from "@/lib/shopping-view"

export interface ShoppingGroupSummary {
  id: string
  keyVersion: number
  membershipRevision: number
  eventSequence: number
  lifecycle: string
  encryptedMetadata: string
  updatedAt: string
  activeMemberCount?: number
  myMember: {
    id: string
    localId: string
    role: string
    status: string
    encryptedAlias: string
    pinnedKeyFingerprint: string
    historyAccess: boolean
  }
  wraps: Array<{ keyVersion: number; wrappedKey: string }>
}

/** Stable empty list — a fresh `[]` each render retriggers ShoppingPage decrypt effects. */
const EMPTY_SHOPPING_GROUPS: ShoppingGroupSummary[] = []

async function shoppingFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError"
}

/**
 * Encrypted shopping state for the signed-in user.
 * Decrypt payloads in the caller with the group content key; this hook never
 * writes plaintext shopping content to storage.
 */
export function useShoppingState() {
  const { currentUserId, encryption } = useApp()
  const unlocked = encryption.ready && !encryption.needsPinUnlock
  const [groupsState, setGroupsState] = useState<{ userId: string; groups: ShoppingGroupSummary[] } | null>(null)
  const [settledUserId, setSettledUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorState, setErrorState] = useState<{ userId: string; message: string } | null>(null)
  const [pendingInvite, setPendingInvite] = useState<{
    token: string
    ownerPublicKey: string | null
    joinCode: string | null
  } | null>(loadPendingShoppingInvite)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const refreshGen = useRef(0)
  const groupsAbort = useRef<AbortController | null>(null)
  const fetchAbort = useRef<AbortController | null>(null)
  const userIdRef = useRef(currentUserId)
  const hasLoadedRef = useRef(false)
  const loadedForUser = useRef(currentUserId)
  userIdRef.current = currentUserId
  if (loadedForUser.current !== currentUserId) {
    loadedForUser.current = currentUserId
    hasLoadedRef.current = false
    refreshGen.current += 1
  }

  const groups =
    unlocked && groupsState?.userId === currentUserId
      ? groupsState.groups
      : EMPTY_SHOPPING_GROUPS
  const error = errorState?.userId === currentUserId ? errorState.message : null
  const loadingGroups = Boolean(
    unlocked && currentUserId && (loading || settledUserId !== currentUserId),
  )

  const refreshGroups = useCallback(async () => {
    const userId = currentUserId
    if (!userId || !unlocked) return
    const gen = ++refreshGen.current
    const background = hasLoadedRef.current
    groupsAbort.current?.abort()
    const controller = new AbortController()
    groupsAbort.current = controller
    if (!background) {
      setLoading(true)
      setErrorState(null)
    }
    try {
      const res = await shoppingFetch("/api/shopping/groups", { signal: controller.signal })
      if (gen !== refreshGen.current || userIdRef.current !== userId) return
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Could not load shared lists")
      }
      const data = (await res.json()) as { groups: ShoppingGroupSummary[] }
      if (gen !== refreshGen.current || userIdRef.current !== userId) return
      hasLoadedRef.current = true
      setSettledUserId(userId)
      setErrorState(null)
      setGroupsState({ userId, groups: data.groups })
      for (const group of data.groups) {
        if (gen !== refreshGen.current || userIdRef.current !== userId) return
        await saveShoppingSnapshot(userId, group.id, JSON.stringify(group))
      }
    } catch (err) {
      if (isAbortError(err)) return
      if (gen !== refreshGen.current || userIdRef.current !== userId) return
      setSettledUserId(userId)
      setErrorState({
        userId,
        message: err instanceof Error ? err.message : "Could not load shared lists",
      })
    } finally {
      if (gen === refreshGen.current && userIdRef.current === userId) setLoading(false)
    }
  }, [currentUserId, unlocked])

  const flushOutbox = useCallback(async () => {
    if (!currentUserId || !unlocked) return
    const items = await listShoppingOutbox(currentUserId)
    for (const item of items) {
      if (!canQueueOffline(item.kind)) {
        await removeShoppingOutboxItem(currentUserId, item.id)
        continue
      }
      const isCheckoff = item.kind === "request_checkoff"
      const res = await shoppingFetch(
        `/api/shopping/groups/${item.groupId}/requests/${item.objectId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            encryptedPayload: item.encryptedPayload,
            expectedRevision: item.expectedRevision,
            keyVersion: item.keyVersion,
            checkoffOnly: isCheckoff,
          }),
        },
      )
      if (res.ok || res.status === 409) {
        await removeShoppingOutboxItem(currentUserId, item.id)
      }
    }
  }, [currentUserId, unlocked])

  useEffect(() => {
    if (!unlocked || !currentUserId) return
    void refreshGroups()
    void flushOutbox()
    pollRef.current = setInterval(() => {
      void refreshGroups()
    }, 20_000)
    return () => {
      refreshGen.current += 1
      groupsAbort.current?.abort()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [unlocked, currentUserId, refreshGroups, flushOutbox])

  const queueCheckoff = useCallback(
    async (item: ShoppingOutboxItem) => {
      if (!currentUserId) return
      if (!canQueueOffline(item.kind)) return
      await enqueueShoppingOutbox(currentUserId, item)
    },
    [currentUserId],
  )

  const submitPendingInvite = useCallback(
    async (encryptedClaimantAlias: string, verificationCode?: string) => {
      const pending = loadPendingShoppingInvite()
      if (!pending) return { ok: false as const, error: "Invite is missing" }
      const code = verificationCode ?? pending.joinCode
      if (!code || !isRequestVerificationCode(code)) {
        return {
          ok: false as const,
          error: "This invite link is incomplete. Ask for a new link.",
        }
      }
      const res = await shoppingFetch("/api/shopping/invitations/claim", {
        method: "POST",
        body: JSON.stringify({
          token: pending.token,
          encryptedClaimantAlias,
          verificationCode: code,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return { ok: false as const, error: body.error || "Could not send join request" }
      clearPendingShoppingInvite()
      setPendingInvite(null)
      return { ok: true as const, verificationCode: code }
    },
    [],
  )

  const encryptAliasToOwner = useCallback(
    async (alias: string): Promise<string | null> => {
      const pending = loadPendingShoppingInvite()
      if (!pending?.ownerPublicKey) return null
      return encryptFieldAsymmetric(alias, hexToPublicKey(pending.ownerPublicKey))
    },
    [],
  )

  const fetchGroupEventsBefore = useCallback(async (
    groupId: string,
    beforeSequence: number,
    signal: AbortSignal,
  ) => {
    const res = await shoppingFetch(
      `/api/shopping/groups/${groupId}/events?beforeSequence=${beforeSequence}`,
      { signal },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error || "Could not load earlier tab history")
    }
    return res.json() as Promise<{ events: ShoppingSnapshotEvent[]; hasMore: boolean }>
  }, [])

  const fetchGroup = useCallback(async (groupId: string) => {
    fetchAbort.current?.abort()
    const controller = new AbortController()
    fetchAbort.current = controller
    const { signal } = controller
    try {
      const res = await shoppingFetch(`/api/shopping/groups/${groupId}`, { signal })
      if (signal.aborted) throw new ShoppingSnapshotSupersededError()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Could not load this group")
      }
      const snapshot = (await res.json()) as ShoppingGroupSnapshot
      const events = await loadCompleteShoppingSnapshotEvents(
        snapshot.events,
        snapshot.eventsMeta,
        (beforeSequence) => {
          if (signal.aborted) throw new ShoppingSnapshotSupersededError()
          return fetchGroupEventsBefore(groupId, beforeSequence, signal)
        },
      )
      if (signal.aborted) throw new ShoppingSnapshotSupersededError()
      return { ...snapshot, events }
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw new ShoppingSnapshotSupersededError()
      throw err
    }
  }, [fetchGroupEventsBefore])

  const createGroup = useCallback(async (body: Record<string, unknown>) => {
    const res = await shoppingFetch("/api/shopping/groups", {
      method: "POST",
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { error?: string }).error || "Could not create group")
    await refreshGroups()
    return data as { id: string; memberId: string; localId: string }
  }, [refreshGroups])

  const postShopping = useCallback(async (url: string, body: Record<string, unknown>, method = "POST") => {
    const res = await shoppingFetch(url, { method, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { error?: string }).error || "Could not save")
    return data as Record<string, unknown>
  }, [])

  const createList = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/lists`, body)
    },
    [postShopping],
  )

  const createRequest = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/requests`, body)
    },
    [postShopping],
  )

  const updateRequest = useCallback(
    async (groupId: string, requestId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/requests/${requestId}`, body, "PATCH")
    },
    [postShopping],
  )

  const fetchClaimantKey = useCallback(async (groupId: string, inviteId: string) => {
    const res = await shoppingFetch(`/api/shopping/groups/${groupId}/invites/${inviteId}/claimant-key`)
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      publicKey?: string
      fingerprint?: string
      encryptedClaimantAlias?: string | null
      verificationCode?: string | null
    }
    if (!res.ok || !data.publicKey || !data.fingerprint) {
      throw new Error(data.error || "Could not load this request")
    }
    return {
      publicKey: data.publicKey,
      fingerprint: data.fingerprint,
      encryptedClaimantAlias: data.encryptedClaimantAlias ?? null,
      verificationCode: data.verificationCode ?? null,
    }
  }, [])

  const respondToInvite = useCallback(
    async (groupId: string, inviteId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/invites/${inviteId}`, body)
    },
    [postShopping],
  )

  const createInvite = useCallback(
    async (groupId: string) => {
      return postShopping(`/api/shopping/groups/${groupId}/invites`, {}) as Promise<{
        id: string
        token: string
        verificationCode: string
        ownerPublicKey: string | null
        expiresAt: string
      }>
    },
    [postShopping],
  )

  const createReceiptDraft = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/receipts`, body)
    },
    [postShopping],
  )

  const finalizeReceipt = useCallback(
    async (groupId: string, receiptId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/receipts/${receiptId}`, body)
    },
    [postShopping],
  )

  const recordPayment = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/payments`, body)
    },
    [postShopping],
  )

  const fetchPreference = useCallback(async (groupId: string) => {
    const res = await shoppingFetch(`/api/shopping/groups/${groupId}/preferences`)
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      enabled?: boolean
      enabledAtSequence?: number | null
      catchUpApproved?: boolean
      envelopeId?: string | null
      preferenceVersion?: number
    }
    if (!res.ok || data.preferenceVersion == null) {
      throw new Error(data.error || "Could not load budget settings")
    }
    return {
      enabled: data.enabled === true,
      enabledAtSequence: data.enabledAtSequence ?? null,
      catchUpApproved: data.catchUpApproved === true,
      envelopeId: data.envelopeId ?? null,
      preferenceVersion: data.preferenceVersion,
    }
  }, [])

  const savePreference = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/preferences`, body, "PUT")
    },
    [postShopping],
  )

  const applyPostings = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      return postShopping(`/api/shopping/groups/${groupId}/postings`, body)
    },
    [postShopping],
  )

  const listPostings = useCallback(async (groupId: string) => {
    const res = await shoppingFetch(`/api/shopping/groups/${groupId}/postings`)
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      postings?: Array<{ eventId: string; entryKey: string; status: string }>
    }
    if (!res.ok || !Array.isArray(data.postings)) {
      throw new Error(data.error || "Could not load budget rows")
    }
    return data.postings
  }, [])

  return {
    groups,
    loading: loadingGroups,
    error,
    unlocked,
    pendingInvite,
    refreshGroups,
    flushOutbox,
    queueCheckoff,
    submitPendingInvite,
    encryptAliasToOwner,
    fetchGroup,
    createGroup,
    createList,
    createRequest,
    updateRequest,
    createInvite,
    fetchClaimantKey,
    respondToInvite,
    createReceiptDraft,
    finalizeReceipt,
    recordPayment,
    fetchPreference,
    savePreference,
    applyPostings,
    listPostings,
    clearPendingInvite: () => {
      clearPendingShoppingInvite()
      setPendingInvite(null)
    },
  }
}
