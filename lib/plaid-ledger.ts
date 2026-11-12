/**
 * Plaid amount sign and balance snapshots.
 *
 * Plaid's transaction `amount` is positive when money leaves the account and
 * negative when money arrives. The ledger stores a positive amount plus a
 * type, so inflows must become credits. Treating them as expenses makes burn
 * too high and the cash cushion too low.
 *
 * Stored balances are a bank snapshot for the connection card. They do not
 * replace envelope remaining (that would count the same dollars twice).
 */

export type LedgerDirection = "expense" | "credit"

export interface PlaidBalanceSnapshot {
  current: number | null
  available: number | null
  isoCurrencyCode: string | null
}

export interface PlaidAccountSnapshot {
  accountId: string
  name: string
  mask: string | null
  type: string
  balances: PlaidBalanceSnapshot
}

export interface DepositoryBalanceInput {
  type: string
  currentBalance: number | null
  availableBalance: number | null
  isoCurrencyCode: string | null
}

/** Map a Plaid transaction amount onto a ledger type and a positive amount. */
export function plaidAmountToLedger(
  amount: number,
): { type: LedgerDirection; amount: number } | null {
  if (!Number.isFinite(amount) || amount === 0) return null
  if (amount > 0) return { type: "expense", amount }
  return { type: "credit", amount: Math.abs(amount) }
}

export function snapshotFromPlaidAccount(account: {
  account_id?: string | null
  name?: string | null
  mask?: string | null
  type?: string | null
  balances?: {
    current?: number | null
    available?: number | null
    iso_currency_code?: string | null
  } | null
}): PlaidAccountSnapshot | null {
  const accountId = account.account_id?.trim()
  if (!accountId) return null
  const balances = account.balances
  return {
    accountId,
    name: account.name?.trim() || "Account",
    mask: account.mask?.trim() || null,
    type: account.type?.trim() || "other",
    balances: {
      current: finiteOrNull(balances?.current),
      available: finiteOrNull(balances?.available),
      isoCurrencyCode: balances?.iso_currency_code?.trim() || null,
    },
  }
}

/**
 * Cash sitting in depository accounts (checking, savings). Uses available
 * when Plaid sent it, otherwise current. Credit cards are owed balances and
 * are left out. Non-USD rows are left out.
 */
export function depositoryCashUsd(accounts: readonly DepositoryBalanceInput[]): number | null {
  let sum = 0
  let counted = 0
  for (const account of accounts) {
    if (account.type !== "depository") continue
    const currency = account.isoCurrencyCode?.trim().toUpperCase() || "USD"
    if (currency !== "USD") continue
    const amount = account.availableBalance ?? account.currentBalance
    if (amount == null || !Number.isFinite(amount)) continue
    sum += amount
    counted += 1
  }
  if (counted === 0) return null
  return Math.round(sum * 100) / 100
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return value
}
