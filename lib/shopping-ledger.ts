/**
 * Pairwise shopping tab reducer.
 * Derives balances from ordered validated events using integer cents.
 * A credit with one shopper never silently pays a different shopper.
 */

import type {
  ShoppingEventPayload,
  ShoppingReceiptFinalizedPayload,
  ShoppingRepaymentPayload,
  ShoppingReversalPayload,
} from "@/lib/shopping-types"

export interface ShoppingLedgerEvent {
  id: string
  sequence: number
  actorMemberId: string
  payload: ShoppingEventPayload
}

export type PairKey = `${string}|${string}`

export function pairKey(a: string, b: string): PairKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export interface PairState {
  /** Net cents the lexicographically-smaller member is owed by the other. Positive = A is owed. */
  netCents: number
  /** Prepaid credit held by each member against this counterpart (cents). */
  prepaidByMember: Record<string, number>
  unpaidReceipts: Array<{ eventId: string; debtorMemberId: string; remainingCents: number }>
}

export interface ShoppingTabState {
  pairs: Map<PairKey, PairState>
  reversedIds: Set<string>
  replacedBy: Map<string, string>
}

function emptyPair(): PairState {
  return { netCents: 0, prepaidByMember: {}, unpaidReceipts: [] }
}

function smallerMember(a: string, b: string): string {
  return a < b ? a : b
}

function getPair(state: ShoppingTabState, a: string, b: string): PairState {
  const key = pairKey(a, b)
  let pair = state.pairs.get(key)
  if (!pair) {
    pair = emptyPair()
    state.pairs.set(key, pair)
  }
  return pair
}

function adjustNet(pair: PairState, fromSmallerPerspectiveCents: number): void {
  pair.netCents += fromSmallerPerspectiveCents
}

function owedBy(pair: PairState, debtor: string, creditor: string): number {
  const small = smallerMember(debtor, creditor)
  if (debtor === small) {
    return Math.max(0, -pair.netCents)
  }
  return Math.max(0, pair.netCents)
}

function applyReceipt(state: ShoppingTabState, event: ShoppingLedgerEvent, payload: ShoppingReceiptFinalizedPayload): void {
  const shareSum = payload.shares.reduce((s, sh) => s + sh.cents, 0)
  if (shareSum !== payload.totalCents) {
    throw new Error("Receipt shares must equal the total")
  }
  for (const share of payload.shares) {
    if (share.memberId === payload.payerMemberId || share.cents === 0) continue
    const pair = getPair(state, payload.payerMemberId, share.memberId)
    const prepaid = pair.prepaidByMember[share.memberId] ?? 0
    let remaining = share.cents
    if (prepaid > 0) {
      const consume = Math.min(prepaid, remaining)
      pair.prepaidByMember[share.memberId] = prepaid - consume
      remaining -= consume
    }
    if (remaining <= 0) continue
    const small = smallerMember(payload.payerMemberId, share.memberId)
    const delta = payload.payerMemberId === small ? remaining : -remaining
    adjustNet(pair, delta)
    pair.unpaidReceipts.push({
      eventId: event.id,
      debtorMemberId: share.memberId,
      remainingCents: remaining,
    })
  }
}

function applyRepayment(state: ShoppingTabState, payload: ShoppingRepaymentPayload): void {
  if (payload.fromMemberId === payload.toMemberId) {
    throw new Error("A repayment needs two different people")
  }
  if (payload.cents <= 0) {
    throw new Error("Repayment must be a positive amount")
  }
  const pair = getPair(state, payload.fromMemberId, payload.toMemberId)
  let remaining = payload.cents
  const debt = owedBy(pair, payload.fromMemberId, payload.toMemberId)
  const payDebt = Math.min(debt, remaining)
  if (payDebt > 0) {
    const small = smallerMember(payload.fromMemberId, payload.toMemberId)
    const delta = payload.fromMemberId === small ? payDebt : -payDebt
    adjustNet(pair, delta)
    remaining -= payDebt
    let toAllocate = payDebt
    for (const rec of pair.unpaidReceipts) {
      if (toAllocate <= 0) break
      if (rec.debtorMemberId !== payload.fromMemberId) continue
      const take = Math.min(rec.remainingCents, toAllocate)
      rec.remainingCents -= take
      toAllocate -= take
    }
    pair.unpaidReceipts = pair.unpaidReceipts.filter((r) => r.remainingCents > 0)
  }
  if (remaining > 0) {
    pair.prepaidByMember[payload.fromMemberId] =
      (pair.prepaidByMember[payload.fromMemberId] ?? 0) + remaining
  }
}

function applyReversal(state: ShoppingTabState, eventsById: Map<string, ShoppingLedgerEvent>, payload: ShoppingReversalPayload): void {
  const original = eventsById.get(payload.reversesEventId)
  if (!original) throw new Error("Cannot reverse an unknown event")
  if (state.reversedIds.has(payload.reversesEventId)) {
    throw new Error("That event was already reversed")
  }
  state.reversedIds.add(payload.reversesEventId)
}

export function reduceShoppingTab(events: readonly ShoppingLedgerEvent[]): ShoppingTabState {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence)
  const eventsById = new Map(ordered.map((e) => [e.id, e]))
  const reversed = new Set<string>()
  const replacedBy = new Map<string, string>()

  for (const event of ordered) {
    if (event.payload.type === "reversal") {
      reversed.add(event.payload.reversesEventId)
    } else if (event.payload.type === "replacement") {
      replacedBy.set(event.payload.replacesEventId, event.id)
      reversed.add(event.payload.replacesEventId)
    }
  }

  const state: ShoppingTabState = {
    pairs: new Map(),
    reversedIds: reversed,
    replacedBy,
  }

  for (const event of ordered) {
    if (reversed.has(event.id) && event.payload.type !== "reversal" && event.payload.type !== "replacement") {
      continue
    }
    switch (event.payload.type) {
      case "receipt_finalized":
        applyReceipt(state, event, event.payload)
        break
      case "repayment":
        applyRepayment(state, event.payload)
        break
      case "reversal":
        applyReversal(state, eventsById, event.payload)
        break
      case "replacement": {
        const inner = event.payload.inner
        if (inner.type === "receipt_finalized") {
          applyReceipt(state, event, { schemaVersion: 1, ...inner })
        } else {
          applyRepayment(state, { schemaVersion: 1, ...inner })
        }
        break
      }
      default: {
        const _never: never = event.payload
        void _never
        throw new Error("Unknown shopping event")
      }
    }
  }
  return state
}

export interface PairwiseBalance {
  memberA: string
  memberB: string
  /** Positive: B owes A. Negative: A owes B. */
  netCents: number
  prepaidA: number
  prepaidB: number
}

export function pairwiseBalances(state: ShoppingTabState): PairwiseBalance[] {
  const out: PairwiseBalance[] = []
  for (const [key, pair] of state.pairs) {
    const [a, b] = key.split("|") as [string, string]
    out.push({
      memberA: a,
      memberB: b,
      netCents: pair.netCents,
      prepaidA: pair.prepaidByMember[a] ?? 0,
      prepaidB: pair.prepaidByMember[b] ?? 0,
    })
  }
  return out.sort((x, y) => x.memberA.localeCompare(y.memberA) || x.memberB.localeCompare(y.memberB))
}

export function amountOwed(state: ShoppingTabState, debtor: string, creditor: string): number {
  if (debtor === creditor) return 0
  const pair = state.pairs.get(pairKey(debtor, creditor))
  if (!pair) return 0
  return owedBy(pair, debtor, creditor)
}

export function prepaidCredit(state: ShoppingTabState, holder: string, counterpart: string): number {
  const pair = state.pairs.get(pairKey(holder, counterpart))
  if (!pair) return 0
  return pair.prepaidByMember[holder] ?? 0
}

export function canRecordRepayment(params: {
  actorMemberId: string
  fromMemberId: string
  toMemberId: string
}): boolean {
  const { actorMemberId, fromMemberId, toMemberId } = params
  if (fromMemberId === toMemberId) return false
  return actorMemberId === fromMemberId || actorMemberId === toMemberId
}
