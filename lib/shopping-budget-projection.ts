/**
 * Per-member private budget projection from ordered shopping events.
 * Opt-in is prospective from enabledAtSequence unless catch-up is approved.
 */

import { looksLikeAsymmetricCiphertext } from "@/lib/crypto"
import type { ShoppingEntryKind, ShoppingProjectedEntry } from "@/lib/shopping-types"
import type { ShoppingLedgerEvent } from "@/lib/shopping-ledger"
import { amountOwed, prepaidCredit, reduceShoppingTab } from "@/lib/shopping-ledger"

const ADVANCE_OUT_MARKER = ":advance_out:"

export interface ShoppingPreferenceSnapshot {
  enabled: boolean
  enabledAtSequence: number | null
  catchUpApproved: boolean
  envelopeId: string | null
  preferenceVersion: number
}

export interface ProjectionContext {
  memberId: string
  preference: ShoppingPreferenceSnapshot
  /** Event ids whose original private advance was skipped/suppressed. */
  missingAdvanceEventIds: ReadonlySet<string>
}

function entry(
  partial: Omit<ShoppingProjectedEntry, "envelopeHint"> & {
    envelopeHint?: ShoppingProjectedEntry["envelopeHint"]
  },
): ShoppingProjectedEntry {
  return { envelopeHint: "default", ...partial }
}

function shouldInclude(event: ShoppingLedgerEvent, pref: ShoppingPreferenceSnapshot): boolean {
  if (!pref.enabled) return false
  return eventAllowedByBudgetOptIn({
    catchUpApproved: pref.catchUpApproved,
    enabledAtSequence: pref.enabledAtSequence,
    eventSequence: event.sequence,
  })
}

/** Whether a private posting may be written for this event. */
export function eventAllowedByBudgetOptIn(params: {
  catchUpApproved: boolean
  enabledAtSequence: number | null
  eventSequence: number
}): boolean {
  if (params.catchUpApproved) return true
  if (params.enabledAtSequence == null) return false
  return params.eventSequence >= params.enabledAtSequence
}

/**
 * Opt-in point stored on the preference. Envelope edits keep the current point.
 * Turning budgeting on, or turning catch-up off, starts at the next group event.
 */
export function budgetOptInSequence(params: {
  enabled: boolean
  catchUpApproved: boolean
  previouslyEnabled: boolean
  previousCatchUpApproved: boolean
  previousEnabledAtSequence: number | null
  groupEventSequence: number
}): number | null {
  if (!params.enabled || params.catchUpApproved) return params.previousEnabledAtSequence
  const openFreshWindow =
    !params.previouslyEnabled ||
    params.previousCatchUpApproved ||
    params.previousEnabledAtSequence == null
  if (openFreshWindow) return params.groupEventSequence + 1
  return params.previousEnabledAtSequence
}

/** Receipt events whose "you covered someone else" row was skipped or removed. */
export function missingAdvanceEventIdsFromPostings(
  rows: readonly { entryKey: string; status: string }[],
): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.status !== "skipped" && row.status !== "suppressed") continue
    const at = row.entryKey.indexOf(ADVANCE_OUT_MARKER)
    if (at <= 0) continue
    ids.add(row.entryKey.slice(0, at))
  }
  return ids
}

export function budgetPayeeReady(payee: string): boolean {
  return looksLikeAsymmetricCiphertext(payee)
}

export function budgetEnvelopeUnavailable(result: Record<string, unknown>): boolean {
  return Array.isArray(result.needsAttention) && result.needsAttention.length > 0
}

export function budgetPostingSkipped(result: Record<string, unknown>): boolean {
  return Array.isArray(result.skipped) && result.skipped.length > 0
}

function repaymentAdvanceWasSkipped(params: {
  applied: readonly ShoppingLedgerEvent[]
  missingAdvanceEventIds: ReadonlySet<string>
  debtorMemberId: string
  payerMemberId: string
}): boolean {
  if (params.missingAdvanceEventIds.size === 0) return false
  for (const event of params.applied) {
    if (!params.missingAdvanceEventIds.has(event.id)) continue
    if (event.payload.type !== "receipt_finalized") continue
    if (event.payload.payerMemberId !== params.payerMemberId) continue
    const share = event.payload.shares.find((row) => row.memberId === params.debtorMemberId)
    if (share && share.cents > 0) return true
  }
  return false
}

export function splitRepaymentForProjection(params: {
  paymentCents: number
  outstandingDebtCents: number
}): { expenseCents: number; prepaidCents: number } {
  const expenseCents = Math.min(params.paymentCents, Math.max(0, params.outstandingDebtCents))
  return { expenseCents, prepaidCents: params.paymentCents - expenseCents }
}

function receiptEntriesForPayer(
  event: ShoppingLedgerEvent,
  me: string,
  prepaidAvailableFromDebtor: (debtorMemberId: string) => number,
): ShoppingProjectedEntry[] {
  if (event.payload.type !== "receipt_finalized") return []
  const payload = event.payload
  if (payload.payerMemberId !== me) return []
  const out: ShoppingProjectedEntry[] = []
  const myShare = payload.shares.find((s) => s.memberId === me)?.cents ?? 0
  if (myShare > 0) {
    out.push(
      entry({
        entryKey: `${event.id}:own_expense`,
        kind: "own_expense",
        cents: myShare,
        type: "expense",
        postedOn: payload.postedOn,
        sourceEventId: event.id,
      }),
    )
  }
  for (const share of payload.shares) {
    if (share.memberId === me || share.cents <= 0) continue
    const prepaid = prepaidAvailableFromDebtor(share.memberId)
    const consume = Math.min(prepaid, share.cents)
    const advance = share.cents - consume
    if (consume > 0) {
      out.push(
        entry({
          entryKey: `${event.id}:prepaid_in:${share.memberId}`,
          kind: "prepaid_in",
          cents: consume,
          type: "credit",
          postedOn: payload.postedOn,
          counterpartMemberId: share.memberId,
          sourceEventId: event.id,
          envelopeHint: "original_advance",
        }),
      )
    }
    if (advance > 0) {
      out.push(
        entry({
          entryKey: `${event.id}:advance_out:${share.memberId}`,
          kind: "advance_out",
          cents: advance,
          type: "expense",
          postedOn: payload.postedOn,
          counterpartMemberId: share.memberId,
          sourceEventId: event.id,
        }),
      )
    }
  }
  return out
}

function receiptEntriesForNonPayer(
  event: ShoppingLedgerEvent,
  me: string,
  prepaidAvailable: number,
): ShoppingProjectedEntry[] {
  if (event.payload.type !== "receipt_finalized") return []
  const payload = event.payload
  if (payload.payerMemberId === me) return []
  const myShare = payload.shares.find((s) => s.memberId === me)?.cents ?? 0
  if (myShare <= 0) return []
  const consume = Math.min(prepaidAvailable, myShare)
  if (consume <= 0) return []
  return [
    entry({
      entryKey: `${event.id}:prepaid_apply`,
      kind: "prepaid_apply",
      cents: consume,
      type: "expense",
      postedOn: payload.postedOn,
      counterpartMemberId: payload.payerMemberId,
      sourceEventId: event.id,
    }),
  ]
}

/**
 * Desired private rows for one member after applying events in order.
 * Does not write; the posting service persists with unique constraints.
 */
export function projectMemberBudget(params: {
  events: readonly ShoppingLedgerEvent[]
  context: ProjectionContext
}): ShoppingProjectedEntry[] {
  const { events, context } = params
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence)
  const reversed = new Set<string>()
  for (const event of ordered) {
    if (event.payload.type === "reversal") reversed.add(event.payload.reversesEventId)
    if (event.payload.type === "replacement") reversed.add(event.payload.replacesEventId)
  }

  const out: ShoppingProjectedEntry[] = []
  const me = context.memberId
  const applied: ShoppingLedgerEvent[] = []

  for (const event of ordered) {
    const prefixTab = reduceShoppingTab(applied)
    if (shouldInclude(event, context.preference)) {
      const live = reversed.has(event.id) && event.payload.type !== "reversal" && event.payload.type !== "replacement"
      if (!live) {
        const payload = event.payload
        if (payload.type === "receipt_finalized") {
          out.push(
            ...receiptEntriesForPayer(event, me, (debtor) => prepaidCredit(prefixTab, debtor, me)),
          )
          out.push(
            ...receiptEntriesForNonPayer(event, me, prepaidCredit(prefixTab, me, payload.payerMemberId)),
          )
        } else if (payload.type === "repayment") {
          const outstanding = amountOwed(prefixTab, payload.fromMemberId, payload.toMemberId)
          const split = splitRepaymentForProjection({
            paymentCents: payload.cents,
            outstandingDebtCents: outstanding,
          })
          if (payload.fromMemberId === me) {
            if (split.expenseCents > 0) {
              out.push(
                entry({
                  entryKey: `${event.id}:repayment_expense`,
                  kind: "repayment_expense",
                  cents: split.expenseCents,
                  type: "expense",
                  postedOn: payload.postedOn,
                  counterpartMemberId: payload.toMemberId,
                  sourceEventId: event.id,
                }),
              )
            }
            if (split.prepaidCents > 0) {
              out.push(
                entry({
                  entryKey: `${event.id}:prepaid_out`,
                  kind: "prepaid_out",
                  cents: split.prepaidCents,
                  type: "expense",
                  postedOn: payload.postedOn,
                  counterpartMemberId: payload.toMemberId,
                  sourceEventId: event.id,
                }),
              )
            }
          } else if (payload.toMemberId === me) {
            if (split.expenseCents > 0) {
              const advanceMissing = repaymentAdvanceWasSkipped({
                applied,
                missingAdvanceEventIds: context.missingAdvanceEventIds,
                debtorMemberId: payload.fromMemberId,
                payerMemberId: me,
              })
              out.push(
                entry({
                  entryKey: `${event.id}:advance_recovery`,
                  kind: "advance_recovery",
                  cents: split.expenseCents,
                  type: "credit",
                  postedOn: payload.postedOn,
                  counterpartMemberId: payload.fromMemberId,
                  sourceEventId: event.id,
                  envelopeHint: advanceMissing ? "default" : "original_advance",
                  ...(advanceMissing ? { needsAttention: true } : {}),
                }),
              )
            }
            if (split.prepaidCents > 0) {
              out.push(
                entry({
                  entryKey: `${event.id}:prepaid_in`,
                  kind: "prepaid_in",
                  cents: split.prepaidCents,
                  type: "credit",
                  postedOn: payload.postedOn,
                  counterpartMemberId: payload.fromMemberId,
                  sourceEventId: event.id,
                }),
              )
            }
          }
        }
      }
    }
    applied.push(event)
  }

  return out
}

export function shoppingEntryLabel(kind: ShoppingEntryKind): string {
  switch (kind) {
    case "own_expense":
      return "Your share"
    case "advance_out":
      return "You covered someone else"
    case "advance_recovery":
      return "They paid you back"
    case "repayment_expense":
      return "You paid them back"
    case "prepaid_out":
      return "Extra you paid ahead"
    case "prepaid_in":
      return "Extra they paid you"
    case "prepaid_apply":
      return "Applied a previous payment"
    case "correction":
      return "Correction"
    default: {
      const _never: never = kind
      return _never
    }
  }
}

/** Direction a private posting must use. Corrections may be either way. */
export function expectedShoppingEntryType(
  kind: ShoppingEntryKind,
): "expense" | "credit" | "either" {
  switch (kind) {
    case "own_expense":
    case "advance_out":
    case "repayment_expense":
    case "prepaid_out":
    case "prepaid_apply":
      return "expense"
    case "advance_recovery":
    case "prepaid_in":
      return "credit"
    case "correction":
      return "either"
    default: {
      const _never: never = kind
      return _never
    }
  }
}

export function shoppingEntryPayee(input: {
  eventType?: string
  merchant?: string | null
}): string {
  if (input.eventType === "receipt_finalized") {
    const merchant = input.merchant?.trim()
    return merchant || "Shared purchase"
  }
  if (input.eventType === "repayment") return "Shared repayment"
  return "Shared shopping"
}

export function kindToTransactionSource(kind: ShoppingEntryKind): string {
  switch (kind) {
    case "own_expense":
      return "shopping_own_expense"
    case "advance_out":
      return "shopping_advance_out"
    case "advance_recovery":
      return "shopping_advance_recovery"
    case "repayment_expense":
      return "shopping_repayment_expense"
    case "prepaid_out":
      return "shopping_prepaid_out"
    case "prepaid_in":
      return "shopping_prepaid_in"
    case "prepaid_apply":
      return "shopping_prepaid_apply"
    case "correction":
      return "shopping_correction"
    default: {
      const _never: never = kind
      return _never
    }
  }
}
