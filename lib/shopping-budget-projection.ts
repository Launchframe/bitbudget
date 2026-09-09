/**
 * Per-member private budget projection from ordered shopping events.
 * Opt-in is prospective from enabledAtSequence unless catch-up is approved.
 */

import type { ShoppingEntryKind, ShoppingProjectedEntry } from "@/lib/shopping-types"
import type { ShoppingLedgerEvent } from "@/lib/shopping-ledger"
import { amountOwed, prepaidCredit, reduceShoppingTab } from "@/lib/shopping-ledger"

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
  if (pref.catchUpApproved) return true
  if (pref.enabledAtSequence == null) return false
  return event.sequence >= pref.enabledAtSequence
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
            if (context.missingAdvanceEventIds.size > 0 && split.expenseCents > 0) {
              out.push(
                entry({
                  entryKey: `${event.id}:needs_attention`,
                  kind: "advance_recovery",
                  cents: split.expenseCents,
                  type: "credit",
                  postedOn: payload.postedOn,
                  counterpartMemberId: payload.fromMemberId,
                  sourceEventId: event.id,
                }),
              )
            } else if (split.expenseCents > 0) {
              out.push(
                entry({
                  entryKey: `${event.id}:advance_recovery`,
                  kind: "advance_recovery",
                  cents: split.expenseCents,
                  type: "credit",
                  postedOn: payload.postedOn,
                  counterpartMemberId: payload.fromMemberId,
                  sourceEventId: event.id,
                  envelopeHint: "original_advance",
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
