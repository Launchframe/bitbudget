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
import { generateRequestVerificationCode } from "@/lib/shopping-invites"
import { canQueueOffline, type ShoppingOutboxItem } from "@/lib/shopping-sync"
import { encryptFieldAsymmetric, hexToPublicKey } from "@/lib/crypto"
import type { ShoppingGroupSnapshot } from "@/lib/shopping-view"

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

async function shoppingFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

/**
 * Encrypted shopping state for the signed-in user.
 * Decrypt payloads in the caller with the group content key; this hook never
 * writes plaintext shopping content to storage.
 */
export function useShoppingState() {
  const { currentUserId, encryption } = useApp()
  const unlocked = encryption.ready && !encryption.needsPinUnlock
  const [groups, setGroups] = useState<ShoppingGroupSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingInvite, setPendingInvite] = useState<{ token: string; ownerPublicKey: string | null } | null>(
    loadPendingShoppingInvite,
  )
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshGroups = useCallback(async () => {
    if (!currentUserId || !unlocked) return
    setLoading(true)
    setError(null)
    try {
      const res = await shoppingFetch("/api/shopping/groups")
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Could not load shared lists")
      }
      const data = (await res.json()) as { groups: ShoppingGroupSummary[] }
      setGroups(data.groups)
      for (const group of data.groups) {
        await saveShoppingSnapshot(currentUserId, group.id, JSON.stringify(group))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shared lists")
    } finally {
      setLoading(false)
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
      const code = verificationCode ?? generateRequestVerificationCode()
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

  const fetchGroup = useCallback(async (groupId: string) => {
    const res = await shoppingFetch(`/api/shopping/groups/${groupId}`)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error || "Could not load this group")
    }
    return res.json() as Promise<ShoppingGroupSnapshot>
  }, [])

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

  return {
    groups: unlocked ? groups : [],
    loading,
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
    clearPendingInvite: () => {
      clearPendingShoppingInvite()
      setPendingInvite(null)
    },
  }
}
