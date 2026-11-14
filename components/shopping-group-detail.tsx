"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  Copy,
  LockKeyhole,
  Plus,
  Receipt,
  Send,
  ShoppingBasket,
  UserPlus,
} from "lucide-react"
import { useApp } from "@/lib/app-context"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"
import { formatShoppingFingerprintDisplay } from "@/lib/shopping-crypto"
import { shoppingInviteUrl } from "@/lib/shopping-invites"
import { centsToUsdLabel, dollarsToCents, newShoppingObjectId } from "@/lib/shopping-payloads"
import { decryptClaimantAlias, prepareApproveMember, prepareDefaultList, prepareEventPayload, prepareReceiptDraft, prepareRequest } from "@/lib/shopping-prepare"
import {
  continueReceiptFinancialAttempt,
  isReceiptAlreadyFinalizedError,
  isReceiptSequenceConflictError,
  markReceiptFinancialAttemptFinalized,
  memberIdsForPlannedReceiptLine,
  planSharedReceiptShares,
  ReceiptPlanError,
  RECEIPT_CHECKOFF_WARNING,
  RECEIPT_SEQUENCE_RETRY_MESSAGE,
  receiptRequestIdsToCheckOff,
  type ReceiptFinancialAttempt,
} from "@/lib/shopping-receipt-plan"
import { SHOPPING_PAYLOAD_SCHEMA_VERSION } from "@/lib/shopping-types"
import { todayTransactionCalendarDay } from "@/lib/transaction-dates"
import {
  decryptGroupSnapshot,
  memberAlias,
  tabSummaryForMember,
  type DecryptedGroupView,
  type DecryptedRequest,
  type ShoppingSnapshotInvite,
} from "@/lib/shopping-view"
import { ShoppingSnapshotSupersededError } from "@/lib/shopping-snapshot-events"
import {
  clearShoppingReceiptAttempt,
  loadShoppingReceiptAttempt,
  saveShoppingReceiptAttempt,
} from "@/lib/shopping-receipt-draft"
import { useShoppingState } from "@/lib/use-shopping-state"
import { amountOwed, reduceShoppingTab } from "@/lib/shopping-ledger"
import { ShoppingBudgetCard } from "@/components/shopping-budget-card"
import { ShoppingReceiptDialog, type ReceiptDraftLine, type ReceiptSaveResult } from "@/components/shopping-receipt-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

type DetailTab = "Requests" | "Receipts" | "Tab" | "Members"
type DetailDialog = "request" | "receipt" | "payment" | "invite" | "invite-history" | null

export function ShoppingGroupDetail() {
  const { selectedEnvelopeId, navigateTo, withPrivacyKey } = useApp()
  const {
    unlocked,
    fetchGroup,
    queueCheckoff,
    flushOutbox,
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
    listPostings,
    savePreference,
    applyPostings,
  } = useShoppingState()
  const [view, setView] = useState<DecryptedGroupView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>("Requests")
  const [dialog, setDialog] = useState<DetailDialog>(null)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<{
    inviteId: string
    alias: string
    fingerprint: string
    verificationCode: string | null
    publicKey: string
  } | null>(null)
  const loadGen = useRef(0)
  const shownGroupId = useRef<string | null>(null)
  const receiptSaveLock = useRef(false)
  const receiptAttemptRef = useRef<{
    groupId: string
    attempt: ReceiptFinancialAttempt
    draftRevision: number | null
    checkoffLines: ReceiptDraftLine[]
  } | null>(null)

  const load = useCallback(async () => {
    const groupId = selectedEnvelopeId
    if (!groupId || !unlocked) return
    const gen = ++loadGen.current
    if (shownGroupId.current !== groupId) {
      shownGroupId.current = groupId
      receiptAttemptRef.current = null
      setView(null)
      setDialog(null)
    }
    setLoadError(null)
    try {
      const snap = await fetchGroup(groupId)
      if (gen !== loadGen.current) return
      const decrypted = await withPrivacyKey((key) => decryptGroupSnapshot(snap, key))
      if (gen !== loadGen.current) return
      if (!decrypted) {
        setLoadError("Unlock your data to open this group.")
        return
      }
      setView(decrypted)
    } catch (err) {
      if (gen !== loadGen.current) return
      if (err instanceof ShoppingSnapshotSupersededError) return
      setLoadError(err instanceof Error ? err.message : "Could not load this group")
    }
  }, [selectedEnvelopeId, unlocked, fetchGroup, withPrivacyKey])

  useEffect(() => {
    void load()
  }, [load])

  if (!selectedEnvelopeId) {
    return (
      <section className="flex flex-col gap-4 pb-10">
        <p className="text-sm text-muted-foreground">Choose a shopping group.</p>
        <Button type="button" variant="outline" onClick={() => navigateTo("shopping")}>
          All shopping groups
        </Button>
      </section>
    )
  }

  const tabSummary = view ? tabSummaryForMember(view, view.me.id) : null
  const openCount = view?.requests.filter((r) => !r.checkedOff).length ?? 0

  return (
    <section className="flex min-w-0 w-full max-w-full flex-col gap-6 pb-10">
      <button
        type="button"
        onClick={() => navigateTo("shopping")}
        className="flex w-fit items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All shopping groups
      </button>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {!view && !loadError && <p className="text-sm text-muted-foreground">Loading group…</p>}

      {view && (
        <>
          <div className="flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-4 sm:p-6 md:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <ShoppingBasket className="size-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold">{view.name}</h1>
                    <span className="rounded-full bg-chart-2/15 px-2.5 py-1 text-[11px] font-medium text-chart-2">
                      {view.lifecycle === "active" ? "Active" : view.lifecycle}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {view.description || "No description"}
                  </p>
                  <div className="mt-4 flex -space-x-2">
                    {view.members.map((member) => (
                      <span
                        key={member.id}
                        className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-secondary text-xs font-semibold"
                        title={member.alias}
                      >
                        {member.initials}
                      </span>
                    ))}
                    {view.me.role === "owner" && (
                      <button
                        type="button"
                        onClick={() => setDialog("invite")}
                        className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground"
                        aria-label="Invite member"
                      >
                        <Plus className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {view.me.role === "owner" && (
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDialog("invite")}>
                  <UserPlus className="size-4" />
                  Invite
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <LockKeyhole className="size-4 text-primary" />
                Only {view.members.length} invited {view.members.length === 1 ? "member" : "members"} can see
                this group
              </span>
            </div>
          </div>

          <ShoppingBudgetCard
            view={view}
            fetchPreference={fetchPreference}
            listPostings={listPostings}
            savePreference={savePreference}
            applyPostings={applyPostings}
          />

          <div className="min-w-0 overflow-x-auto border-b border-border">
            <div className="flex min-w-max gap-6" role="tablist" aria-label="Group sections">
              {(["Requests", "Receipts", "Tab", "Members"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={tab === item}
                  onClick={() => setTab(item)}
                  className={`border-b-2 px-1 pb-3 text-sm font-medium transition ${
                    tab === item
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item}
                  {item === "Requests" && openCount > 0 && (
                    <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                      {openCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {tab === "Requests" && (
            <RequestsTab
              view={view}
              busy={busy}
              onAdd={() => setDialog("request")}
              onToggle={(req) => void toggleRequest(req)}
            />
          )}
          {tab === "Receipts" && <ReceiptsTab view={view} onAdd={() => setDialog("receipt")} />}
          {tab === "Tab" && tabSummary && (
            <TabPanel view={view} summary={tabSummary} onPayment={() => setDialog("payment")} />
          )}
          {tab === "Members" && (
            <MembersTab
              view={view}
              onInvite={() => setDialog("invite")}
              onInviteHistory={() => setDialog("invite-history")}
              onReview={(invite) => void openReview(invite)}
              onReject={(inviteId) => void decideInvite(inviteId, "reject")}
            />
          )}
        </>
      )}

      {view && dialog === "request" && (
        <RequestDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(description, notes) => void addRequest(description, notes)}
        />
      )}
      {view && dialog === "receipt" && (
        <ShoppingReceiptDialog
          groupId={view.groupId}
          busy={busy}
          requests={view.requests
            .filter((request) =>
              view.members.some((member) => member.id === request.requesterMemberId && member.status === "active"),
            )
            .map((request) => ({
              id: request.id,
              memberId: request.requesterMemberId,
              description: request.description,
              requestedQuantity: request.requestedQuantity,
              purchasedQuantity: request.purchasedQuantity,
              unit: request.unit,
              checkedOff: request.checkedOff,
            }))}
          members={view.members.map((member) => ({ id: member.id, alias: member.alias }))}
          onClose={() => setDialog(null)}
          onSave={async (merchant, totalCents, lines) => {
            const result = await addReceipt(merchant, totalCents, lines)
            if (result.ok) {
              setDialog(null)
              await load()
              if (result.warning) setLoadError(result.warning)
            }
            return result
          }}
        />
      )}
      {view && dialog === "payment" && (
        <PaymentDialog
          view={view}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(counterpartId, cents, iPaidThem) => void addPayment(counterpartId, cents, iPaidThem)}
        />
      )}
      {view && review && (
        <ApproveRequestDialog
          alias={review.alias}
          fingerprint={review.fingerprint}
          verificationCode={review.verificationCode}
          busy={busy}
          onClose={() => setReview(null)}
          onDecline={() => void decideInvite(review.inviteId, "reject")}
          onApprove={(compared) => void approveRequest(review, compared)}
        />
      )}
      {view && dialog === "invite" && (
        <InviteDialog
          view={view}
          createInvite={createInvite}
          onClose={() => setDialog(null)}
          onOpenHistory={() => setDialog("invite-history")}
        />
      )}
      {view && dialog === "invite-history" && (
        <InviteHistoryDialog
          view={view}
          busy={busy}
          onClose={() => setDialog(null)}
          onInvite={() => setDialog("invite")}
          onReview={(invite) => {
            setDialog(null)
            void openReview(invite)
          }}
          onReject={(inviteId) => void decideInvite(inviteId, "reject")}
          onRevoke={(inviteId) => void revokeInvite(inviteId)}
        />
      )}
    </section>
  )

  async function openReview(invite: ShoppingSnapshotInvite) {
    if (!view || invite.status !== "requested") return
    setBusy(true)
    setLoadError(null)
    try {
      const claimant = await fetchClaimantKey(view.groupId, invite.id)
      if (!claimant.encryptedClaimantAlias) {
        setLoadError("This request is missing a name.")
        return
      }
      const alias = await withPrivacyKey((key) =>
        decryptClaimantAlias(claimant.encryptedClaimantAlias as string, key),
      )
      if (!alias) {
        setLoadError("Unlock your data to review this request.")
        return
      }
      setReview({
        inviteId: invite.id,
        alias,
        fingerprint: claimant.fingerprint,
        verificationCode: claimant.verificationCode,
        publicKey: claimant.publicKey,
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this request")
    } finally {
      setBusy(false)
    }
  }

  async function decideInvite(inviteId: string, action: "reject" | "revoke") {
    if (!view) return
    setBusy(true)
    try {
      await respondToInvite(view.groupId, inviteId, { action })
      setReview(null)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not update this invite")
    } finally {
      setBusy(false)
    }
  }

  async function revokeInvite(inviteId: string) {
    await decideInvite(inviteId, "revoke")
  }

  async function approveRequest(
    pending: {
      inviteId: string
      alias: string
      fingerprint: string
      publicKey: string
    },
    compared: boolean,
  ) {
    if (!view || !compared) return
    setBusy(true)
    try {
      const prepared = await withPrivacyKey(() =>
        prepareApproveMember({
          groupId: view.groupId,
          groupKey: view.groupKey,
          keyVersion: view.keyVersion,
          claimantPublicKeyHex: pending.publicKey,
          alias: pending.alias,
        }),
      )
      if (!prepared) {
        setLoadError("Unlock your data to approve this request.")
        return
      }
      await respondToInvite(view.groupId, pending.inviteId, {
        action: "approve",
        expectedFingerprint: pending.fingerprint,
        wrappedKey: prepared.wrappedKey,
        encryptedAlias: prepared.encryptedAlias,
        localId: prepared.localId,
        memberKeyVersion: prepared.memberKeyVersion,
      })
      setReview(null)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not approve this request")
    } finally {
      setBusy(false)
    }
  }

  async function toggleRequest(req: DecryptedRequest) {
    if (!view) return
    setBusy(true)
    try {
      const nextChecked = !req.checkedOff
      const encryptedPayload = await prepareRequest({
        groupId: view.groupId,
        groupKey: view.groupKey,
        keyVersion: view.keyVersion,
        revision: req.revision + 1,
        requestId: req.id,
        description: req.description,
        notes: req.notes,
        unit: req.unit,
        requestedQuantity: req.requestedQuantity,
        purchasedQuantity: nextChecked ? req.requestedQuantity : req.purchasedQuantity,
        checkedOff: nextChecked,
      })
      await queueCheckoff({
        id: newShoppingObjectId(),
        groupId: view.groupId,
        kind: "request_checkoff",
        objectId: req.id,
        expectedRevision: req.revision,
        encryptedPayload,
        keyVersion: view.keyVersion,
        queuedAt: new Date().toISOString(),
      })
      await flushOutbox()
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not update item")
    } finally {
      setBusy(false)
    }
  }

  async function addRequest(description: string, notes: string) {
    if (!view) return
    setBusy(true)
    try {
      let listId = view.lists[0]?.id
      if (!listId) {
        const list = await prepareDefaultList({
          groupId: view.groupId,
          groupKey: view.groupKey,
          keyVersion: view.keyVersion,
        })
        await createList(view.groupId, {
          id: list.id,
          encryptedPayload: list.encryptedPayload,
          keyVersion: list.keyVersion,
        })
        listId = list.id
      }
      const requestId = newShoppingObjectId()
      const encryptedPayload = await prepareRequest({
        groupId: view.groupId,
        groupKey: view.groupKey,
        keyVersion: view.keyVersion,
        revision: 1,
        requestId,
        description,
        notes: notes.trim() || undefined,
      })
      await createRequest(view.groupId, {
        id: requestId,
        listId,
        requesterMemberId: view.me.id,
        encryptedPayload,
        keyVersion: view.keyVersion,
      })
      setDialog(null)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not add item")
    } finally {
      setBusy(false)
    }
  }

  function forgetReceiptAttempt(groupId: string) {
    if (receiptAttemptRef.current?.groupId === groupId) receiptAttemptRef.current = null
    clearShoppingReceiptAttempt(groupId)
  }

  function rememberReceiptAttempt(
    state: {
      groupId: string
      attempt: ReceiptFinancialAttempt
      draftRevision: number | null
      checkoffLines: ReceiptDraftLine[]
    } | null,
  ) {
    receiptAttemptRef.current = state
    if (!state) return
    saveShoppingReceiptAttempt({
      version: 1,
      groupId: state.groupId,
      receiptId: state.attempt.receiptId,
      operationId: state.attempt.operationId,
      draftRevision: state.draftRevision,
      finalized: state.attempt.finalized,
      checkoffRequestIds: state.checkoffLines.flatMap((line) => (line.requestId ? [line.requestId] : [])),
    })
  }

  function storedReceiptAttempt(groupId: string) {
    const memory = receiptAttemptRef.current
    if (memory?.groupId === groupId) return memory
    const saved = loadShoppingReceiptAttempt(groupId)
    if (!saved) return null
    const restored = {
      groupId,
      attempt: {
        receiptId: saved.receiptId,
        operationId: saved.operationId,
        finalized: saved.finalized,
      },
      draftRevision: saved.draftRevision,
      checkoffLines: saved.checkoffRequestIds.map((requestId) => ({
        description: "",
        cents: 0,
        requestId,
      })),
    }
    receiptAttemptRef.current = restored
    return restored
  }

  async function addReceipt(
    merchant: string,
    totalCents: number,
    lines: ReceiptDraftLine[],
  ): Promise<ReceiptSaveResult> {
    if (!view) return { ok: false, message: "Could not save receipt" }
    if (receiptSaveLock.current) return { ok: false, ignored: true }
    receiptSaveLock.current = true
    setBusy(true)
    const groupId = view.groupId
    try {
      const active = view.members.filter((member) => member.status === "active")
      let shares: Array<{ memberId: string; cents: number }>
      try {
        shares = planSharedReceiptShares({
          totalCents,
          memberIds: active.map((member) => member.id),
          lines: lines.map((line) => ({
            cents: line.cents,
            memberIds: memberIdsForPlannedReceiptLine({
              requestId: line.requestId,
              activeMemberIds: active.map((member) => member.id),
              requests: view.requests,
            }),
          })),
        })
      } catch (err) {
        const message = err instanceof ReceiptPlanError ? err.message : "Could not split this receipt"
        return { ok: false, message }
      }

      const stored = storedReceiptAttempt(groupId)
      const planned = continueReceiptFinancialAttempt(stored?.attempt ?? null, () => ({
        receiptId: newShoppingObjectId(),
        operationId: newShoppingObjectId(),
      }))
      let attempt = planned.attempt
      let draftRevision = planned.attempt.receiptId === stored?.attempt.receiptId ? stored.draftRevision : null
      let checkoffLines =
        planned.attempt.receiptId === stored?.attempt.receiptId ? (stored?.checkoffLines ?? lines) : lines
      rememberReceiptAttempt({ groupId, attempt, draftRevision, checkoffLines })

      const postedOn = todayTransactionCalendarDay()
      if (planned.writeFinancial) {
        let alreadyFinalized = false
        try {
          const encryptedPayload = await prepareReceiptDraft({
            groupId,
            groupKey: view.groupKey,
            keyVersion: view.keyVersion,
            revision: draftRevision == null ? 1 : draftRevision + 1,
            receiptId: attempt.receiptId,
            merchant,
            postedOn,
            totalCents,
          })
          const created = await createReceiptDraft(groupId, {
            id: attempt.receiptId,
            payerMemberId: view.me.id,
            listId: view.lists[0]?.id,
            encryptedPayload,
            keyVersion: view.keyVersion,
          })
          draftRevision =
            typeof created.revision === "number" ? created.revision : draftRevision == null ? 1 : draftRevision + 1
          rememberReceiptAttempt({ groupId, attempt, draftRevision, checkoffLines })
        } catch (err) {
          if (isReceiptSequenceConflictError(err)) {
            await load()
            return { ok: false, message: RECEIPT_SEQUENCE_RETRY_MESSAGE }
          }
          if (!isReceiptAlreadyFinalizedError(err)) throw err
          alreadyFinalized = true
        }
        if (!alreadyFinalized) {
          const eventPayload = {
            schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
            type: "receipt_finalized" as const,
            receiptId: attempt.receiptId,
            payerMemberId: view.me.id,
            postedOn,
            currency: "USD" as const,
            totalCents,
            shares,
          }
          const encryptedEvent = await prepareEventPayload({
            groupId,
            groupKey: view.groupKey,
            keyVersion: view.keyVersion,
            operationId: attempt.operationId,
            payload: eventPayload,
          })
          checkoffLines = lines
          rememberReceiptAttempt({ groupId, attempt, draftRevision, checkoffLines })
          try {
            await finalizeReceipt(groupId, attempt.receiptId, {
              action: "finalize",
              type: "receipt_finalized",
              encryptedPayload: encryptedEvent,
              expectedSequence: view.eventSequence,
              keyVersion: view.keyVersion,
              operationId: attempt.operationId,
              payerMemberId: view.me.id,
              affectedMemberIds: shares.map((share) => share.memberId),
            })
          } catch (err) {
            if (isReceiptSequenceConflictError(err)) {
              await load()
              return { ok: false, message: RECEIPT_SEQUENCE_RETRY_MESSAGE }
            }
            if (!isReceiptAlreadyFinalizedError(err)) throw err
          }
        }
        attempt = markReceiptFinancialAttemptFinalized(attempt)
        rememberReceiptAttempt({ groupId, attempt, draftRevision, checkoffLines })
      }

      const failed: string[] = []
      await Promise.all(
        receiptRequestIdsToCheckOff(checkoffLines, view.requests).map(async (requestId) => {
          const request = view.requests.find((item) => item.id === requestId)
          if (!request) return
          try {
            // The receipt line has no quantity. Marking the list item purchased matches tapping it.
            const encryptedRequest = await prepareRequest({
              groupId,
              groupKey: view.groupKey,
              keyVersion: view.keyVersion,
              revision: request.revision + 1,
              requestId: request.id,
              description: request.description,
              notes: request.notes,
              unit: request.unit,
              requestedQuantity: request.requestedQuantity,
              purchasedQuantity: request.requestedQuantity,
              checkedOff: true,
            })
            await updateRequest(groupId, request.id, {
              encryptedPayload: encryptedRequest,
              expectedRevision: request.revision,
              keyVersion: view.keyVersion,
              checkoffOnly: true,
            })
          } catch {
            failed.push(requestId)
          }
        }),
      )
      try {
        await flushOutbox()
      } catch {
        // Older list updates stay queued. The receipt itself is already saved.
      }
      forgetReceiptAttempt(groupId)
      if (failed.length > 0) return { ok: true, warning: RECEIPT_CHECKOFF_WARNING }
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Could not save receipt" }
    } finally {
      receiptSaveLock.current = false
      setBusy(false)
    }
  }

  async function addPayment(counterpartId: string, cents: number, iPaidThem: boolean) {
    if (!view) return
    setBusy(true)
    try {
      const fromMemberId = iPaidThem ? view.me.id : counterpartId
      const toMemberId = iPaidThem ? counterpartId : view.me.id
      const operationId = newShoppingObjectId()
      const payload = {
        schemaVersion: SHOPPING_PAYLOAD_SCHEMA_VERSION,
        type: "repayment" as const,
        fromMemberId,
        toMemberId,
        cents,
        postedOn: todayTransactionCalendarDay(),
      }
      const encryptedPayload = await prepareEventPayload({
        groupId: view.groupId,
        groupKey: view.groupKey,
        keyVersion: view.keyVersion,
        operationId,
        payload,
      })
      await recordPayment(view.groupId, {
        encryptedPayload,
        expectedSequence: view.eventSequence,
        keyVersion: view.keyVersion,
        operationId,
        affectedMemberIds: [fromMemberId, toMemberId],
      })
      setDialog(null)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not record payment")
    } finally {
      setBusy(false)
    }
  }
}

function RequestsTab({
  view,
  busy,
  onAdd,
  onToggle,
}: {
  view: DecryptedGroupView
  busy: boolean
  onAdd: () => void
  onToggle: (req: DecryptedRequest) => void
}) {
  const grouped = new Map<string, DecryptedRequest[]>()
  for (const req of view.requests) {
    const list = grouped.get(req.requesterMemberId) ?? []
    list.push(req)
    grouped.set(req.requesterMemberId, list)
  }
  const purchased = view.requests.filter((r) => r.checkedOff).length
  const listTitle = view.lists[0]?.title ?? "Current trip"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">Current trip</p>
          <p className="mt-1 font-medium">{listTitle}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-sm font-medium">
            {purchased} of {view.requests.length} purchased
          </p>
        </div>
      </div>
      {view.requests.length === 0 && (
        <p className="text-sm text-muted-foreground">No items yet. Add a request to get started.</p>
      )}
      {[...grouped.entries()].map(([memberId, items]) => {
        const person = memberAlias(view, memberId)
        const initials = view.members.find((m) => m.id === memberId)?.initials ?? "?"
        return (
          <div key={memberId} className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <div className="flex items-center gap-3 border-b border-border/60 bg-secondary/30 px-4 py-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                {initials}
              </span>
              <div>
                <p className="text-sm font-semibold">Requests by {person}</p>
                <p className="text-xs text-muted-foreground">{items.length} items</p>
              </div>
            </div>
            <div className="flex flex-col">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 border-b border-border/50 px-4 py-4 last:border-0 ${item.checkedOff ? "opacity-55" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(item)}
                    disabled={busy}
                    aria-label={`${item.checkedOff ? "Uncheck" : "Check off"} ${item.description}`}
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition ${
                      item.checkedOff
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/50 hover:border-primary"
                    }`}
                  >
                    {item.checkedOff && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${item.checkedOff ? "line-through" : ""}`}>{item.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.requestedQuantity}
                      {item.unit ? ` ${item.unit}` : ""}
                      {item.notes ? ` · ${item.notes}` : ""}
                    </p>
                  </div>
                  {item.checkedOff && (
                    <span className="rounded-full bg-chart-2/15 px-2 py-1 text-[10px] font-medium text-chart-2">
                      Purchased
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 py-3 text-sm font-medium text-primary transition hover:bg-primary/5"
      >
        <Plus className="size-4" />
        Add a request
      </button>
    </div>
  )
}

function ReceiptsTab({ view, onAdd }: { view: DecryptedGroupView; onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Shared receipts</h2>
          <p className="text-sm text-muted-foreground">
            Enter a receipt to split evenly among members. Item matching can wait.
          </p>
        </div>
        <Button type="button" className="rounded-xl" onClick={onAdd}>
          <Plus className="size-4" />
          Add receipt
        </Button>
      </div>
      {view.receipts.length === 0 && (
        <p className="text-sm text-muted-foreground">No receipts yet.</p>
      )}
      {view.receipts.map((receipt) => (
        <div
          key={receipt.id}
          className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-5 sm:flex-row sm:items-center"
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
            <Receipt className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{receipt.merchant}</h3>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                  receipt.status === "finalized"
                    ? "bg-chart-2/15 text-chart-2"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {receipt.status === "finalized" ? "Finalized" : "Draft"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {receipt.postedOn} · Paid by {memberAlias(view, receipt.payerMemberId)}
            </p>
          </div>
          <p className="text-lg font-semibold">{centsToUsdLabel(receipt.totalCents)}</p>
        </div>
      ))}
    </div>
  )
}

function TabPanel({
  view,
  summary,
  onPayment,
}: {
  view: DecryptedGroupView
  summary: { owedToMeCents: number; iOweCents: number }
  onPayment: () => void
}) {
  const tab = reduceShoppingTab(view.events)
  const rows = view.members
    .filter((m) => m.id !== view.me.id)
    .map((m) => ({
      member: m,
      theyOwe: amountOwed(tab, m.id, view.me.id),
      iOwe: amountOwed(tab, view.me.id, m.id),
    }))

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <p className="text-sm text-muted-foreground">Net owed to you</p>
          <p className="mt-2 text-3xl font-semibold text-primary">{centsToUsdLabel(summary.owedToMeCents)}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <p className="text-sm text-muted-foreground">You owe</p>
          <p className="mt-2 text-3xl font-semibold">{centsToUsdLabel(summary.iOweCents)}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Running tab</h2>
          <p className="text-sm text-muted-foreground">A record only — no money moves automatically.</p>
        </div>
        <Button type="button" variant="outline" className="rounded-xl" onClick={onPayment}>
          <Plus className="size-4" />
          Record payment
        </Button>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Invite someone to start a tab.</p>
      )}
      {rows.map((row) => (
        <div key={row.member.id} className="flex items-center gap-3 border-b border-border/60 py-4">
          <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
            {row.member.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{row.member.alias}</p>
            <p className="text-xs text-muted-foreground">
              {row.theyOwe > 0
                ? `Owes you ${centsToUsdLabel(row.theyOwe)}`
                : row.iOwe > 0
                  ? `You owe ${centsToUsdLabel(row.iOwe)}`
                  : "Settled"}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function inviteStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Link open"
    case "requested":
      return "Waiting for you"
    case "approved":
      return "Joined"
    case "revoked":
      return "Revoked"
    case "rejected":
      return "Declined"
    case "expired":
      return "Expired"
    default:
      return status
  }
}

function MembersTab({
  view,
  onInvite,
  onInviteHistory,
  onReview,
  onReject,
}: {
  view: DecryptedGroupView
  onInvite: () => void
  onInviteHistory: () => void
  onReview: (invite: ShoppingSnapshotInvite) => void
  onReject: (inviteId: string) => void
}) {
  const joinRequests = view.invites.filter((invite) => invite.status === "requested")
  const openLinks = view.invites.filter((invite) => invite.status === "pending").length
  const historyCount = view.invites.length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Group members</h2>
          <p className="text-sm text-muted-foreground">Aliases are shown instead of account details.</p>
        </div>
        {view.me.role === "owner" && (
          <Button type="button" className="rounded-xl" onClick={onInvite}>
            <UserPlus className="size-4" />
            Add member
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        {view.members.map((member) => (
          <div key={member.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-4 last:border-0">
            <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              {member.initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {member.alias}
                {member.id === view.me.id ? " (you)" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {member.role === "owner" ? "Owner" : "Member"} ·{" "}
                {formatShoppingFingerprintDisplay(member.fingerprint)}
              </p>
            </div>
            <span className="rounded-full bg-chart-2/15 px-2 py-1 text-[10px] text-chart-2">{member.status}</span>
          </div>
        ))}
      </div>
      {view.me.role === "owner" && joinRequests.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Join requests</h2>
          {joinRequests.map((invite) => (
            <div
              key={invite.id}
              className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">Someone asked to join</p>
                <p className="text-xs text-muted-foreground">
                  {invite.verificationCode
                    ? `Code ${invite.verificationCode} · `
                    : ""}
                  Expires {new Date(invite.expiresAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" onClick={() => onReview(invite)}>
                  Review
                </Button>
                <Button type="button" variant="ghost" onClick={() => onReject(invite.id)}>
                  Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {view.me.role === "owner" && (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {openLinks > 0
              ? `${openLinks} open invite ${openLinks === 1 ? "link" : "links"} · `
              : ""}
            Your compare code:{" "}
            <span className="font-mono text-foreground">
              {formatShoppingFingerprintDisplay(view.me.fingerprint)}
            </span>
          </p>
          <Button type="button" variant="ghost" className="h-auto px-0 text-xs" onClick={onInviteHistory}>
            Invite history{historyCount > 0 ? ` (${historyCount})` : ""}
          </Button>
        </div>
      )}
    </div>
  )
}

function RequestDialog({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean
  onClose: () => void
  onSave: (description: string, notes: string) => void
}) {
  const [description, setDescription] = useState("")
  const [notes, setNotes] = useState("")
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="max-w-[min(96vw,32rem)] rounded-2xl border-border bg-card"
        onKeyDown={(e) =>
          handleDialogEnterToPrimary(e, { disabled: busy || !description.trim(), onPrimary: () => onSave(description, notes) })
        }
      >
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Add a request</DialogTitle>
          <DialogDescription>This item is encrypted for the group.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-sm font-medium">
          What should be picked up?
          <Input
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Greek yogurt"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium" data-no-enter-submit="">
          Quantity or note
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="2 tubs · plain, full fat"
            className="min-h-20"
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !description.trim()} onClick={() => onSave(description, notes)}>
            Add to list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PaymentDialog({
  view,
  busy,
  onClose,
  onSave,
}: {
  view: DecryptedGroupView
  busy: boolean
  onClose: () => void
  onSave: (counterpartId: string, cents: number, iPaidThem: boolean) => void
}) {
  const others = view.members.filter((m) => m.id !== view.me.id)
  const [counterpartId, setCounterpartId] = useState(others[0]?.id ?? "")
  const [amount, setAmount] = useState("")
  const [iPaidThem, setIPaidThem] = useState(true)
  const cents = dollarsToCents(amount)
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-[min(96vw,32rem)] rounded-2xl border-border bg-card">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>This records a real-world payment for bookkeeping. No money is transferred automatically.</DialogDescription>
        </DialogHeader>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">Invite someone before recording a payment.</p>
        ) : (
          <>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Person
              <select
                className="rounded-xl border border-input bg-background px-4 py-3 text-sm"
                value={counterpartId}
                onChange={(e) => setCounterpartId(e.target.value)}
              >
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.alias}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Amount
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" inputMode="decimal" />
            </label>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>I paid them</span>
              <Switch checked={iPaidThem} onCheckedChange={setIPaidThem} aria-label="I paid them" />
            </div>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !counterpartId || cents == null || cents <= 0}
            onClick={() => cents != null && onSave(counterpartId, cents, iPaidThem)}
          >
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApproveRequestDialog({
  alias,
  fingerprint,
  verificationCode,
  busy,
  onClose,
  onDecline,
  onApprove,
}: {
  alias: string
  fingerprint: string
  verificationCode: string | null
  busy: boolean
  onClose: () => void
  onDecline: () => void
  onApprove: (compared: boolean) => void
}) {
  const [compared, setCompared] = useState(false)
  const shortFingerprint = formatShoppingFingerprintDisplay(fingerprint)
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-[min(96vw,32rem)] rounded-2xl border-border bg-card">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Let {alias} join?</DialogTitle>
          <DialogDescription>
            Compare the short codes with them before you add them. Their name stays encrypted for the group.
          </DialogDescription>
        </DialogHeader>
        {verificationCode && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Join code</p>
            <p className="font-mono text-2xl tracking-[0.2em]">{verificationCode}</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Their compare code</p>
          <p className="font-mono text-xl tracking-widest">{shortFingerprint}</p>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>I compared this with them</span>
          <Switch checked={compared} onCheckedChange={setCompared} aria-label="I compared this with them" />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
          <Button type="button" disabled={busy || !compared} onClick={() => onApprove(compared)}>
            Add to group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InviteDialog({
  view,
  createInvite,
  onClose,
  onOpenHistory,
}: {
  view: DecryptedGroupView
  createInvite: (groupId: string) => Promise<{ token: string; ownerPublicKey: string | null; expiresAt: string }>
  onClose: () => void
  onOpenHistory: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const compareCode = formatShoppingFingerprintDisplay(view.me.fingerprint)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await createInvite(view.groupId)
      setUrl(shoppingInviteUrl(window.location.origin, created.token, created.ownerPublicKey))
      setExpiresAt(created.expiresAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invite")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-[min(96vw,32rem)] rounded-2xl border-border bg-card">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Invite to {view.name}</DialogTitle>
          <DialogDescription>
            Invite someone explicitly. They will only see this group’s requests, receipts, and balances — never
            your private budget.
          </DialogDescription>
        </DialogHeader>
        {!url ? (
          <Button type="button" disabled={busy || view.me.role !== "owner"} onClick={() => void create()}>
            <Send className="size-4" />
            Create invite link
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="break-all rounded-xl border border-border bg-background p-3 font-mono text-xs">{url}</p>
            <div className="rounded-xl border border-border/70 bg-secondary/40 px-3 py-3">
              <p className="text-xs text-muted-foreground">Your compare code</p>
              <p className="font-mono text-xl tracking-widest">{compareCode}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Copy the link now — BitBudget cannot show it again after you close this (by design). When they
              join, check their short codes with them by call or in person.
              {expiresAt ? ` Expires ${new Date(expiresAt).toLocaleString()}.` : ""}
            </p>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              <Copy className="size-4" />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" className="sm:mr-auto" onClick={onOpenHistory}>
            Invite history
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InviteHistoryDialog({
  view,
  busy,
  onClose,
  onInvite,
  onReview,
  onReject,
  onRevoke,
}: {
  view: DecryptedGroupView
  busy: boolean
  onClose: () => void
  onInvite: () => void
  onReview: (invite: ShoppingSnapshotInvite) => void
  onReject: (inviteId: string) => void
  onRevoke: (inviteId: string) => void
}) {
  const compareCode = formatShoppingFingerprintDisplay(view.me.fingerprint)
  const invites = view.invites

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-h-[min(90vh,40rem)] max-w-[min(96vw,32rem)] overflow-y-auto rounded-2xl border-border bg-card">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Invite history</DialogTitle>
          <DialogDescription>
            Open links, waiting requests, and recent outcomes. Invite links cannot be recovered after you close
            the create dialog — revoke unused ones here.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border/70 bg-secondary/40 px-3 py-3">
          <p className="text-xs text-muted-foreground">Your compare code</p>
          <p className="font-mono text-xl tracking-widest">{compareCode}</p>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invites yet for this group.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{inviteStatusLabel(invite.status)}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(invite.createdAt).toLocaleString()}
                    {invite.status === "pending" || invite.status === "requested"
                      ? ` · Expires ${new Date(invite.expiresAt).toLocaleString()}`
                      : ""}
                  </p>
                  {invite.verificationCode && (
                    <p className="mt-1 font-mono text-sm tracking-widest">{invite.verificationCode}</p>
                  )}
                  {invite.claimantKeyFingerprint && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Their compare code{" "}
                      <span className="font-mono text-foreground">
                        {formatShoppingFingerprintDisplay(invite.claimantKeyFingerprint)}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {invite.status === "requested" && (
                    <>
                      <Button type="button" disabled={busy} onClick={() => onReview(invite)}>
                        Review
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onReject(invite.id)}
                      >
                        Decline
                      </Button>
                    </>
                  )}
                  {invite.status === "pending" && (
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => onRevoke(invite.id)}>
                      Revoke link
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" className="sm:mr-auto" onClick={onInvite}>
            <UserPlus className="size-4" />
            New invite
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
