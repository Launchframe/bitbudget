export interface PlaidConnectionAccountSummary {
  accountName: string
  mask: string | null
  type: string
}

/** User-facing label for a linked account row, e.g. "Checking ••1234". */
export function formatPlaidAccountLabel(account: PlaidConnectionAccountSummary): string {
  const name = account.accountName.trim() || "Account"
  const mask = account.mask?.trim()
  return mask ? `${name} ••${mask}` : name
}

export interface PlaidAccountBalanceSummary extends PlaidConnectionAccountSummary {
  currentBalance?: number | null
  availableBalance?: number | null
  isoCurrencyCode?: string | null
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

/**
 * Balance phrase for a connection row.
 * Checking and savings use available cash when Plaid sent it, otherwise current,
 * so the row matches the "cash in checking and savings" total.
 * Credit cards show what is owed. A negative credit balance is a credit on the card.
 * Returns null until Plaid has sent a balance, and for non-USD rows.
 */
export function formatPlaidAccountBalance(account: PlaidAccountBalanceSummary): string | null {
  const currency = account.isoCurrencyCode?.trim().toUpperCase() || "USD"
  if (currency !== "USD") return null
  if (account.type === "credit") {
    const current = account.currentBalance
    if (current == null || !Number.isFinite(current)) return null
    if (current < 0) return `${formatUsd(Math.abs(current))} credit`
    return `${formatUsd(current)} owed`
  }
  const amount = account.availableBalance ?? account.currentBalance
  if (amount == null || !Number.isFinite(amount)) return null
  return formatUsd(amount)
}

/** Success copy after Link completes. */
export function plaidConnectSuccessMessage(
  institutionName: string,
  accountCount: number,
): string {
  const bank = institutionName.trim() || "bank"
  if (accountCount === 1) {
    return `Your ${bank} account was successfully connected!`
  }
  return `Your ${bank} accounts were successfully connected!`
}

/** Plain-language institution title for connection cards. */
export function formatPlaidInstitutionTitle(institutionName: string | null): string {
  return institutionName?.trim() || "Connected bank"
}
