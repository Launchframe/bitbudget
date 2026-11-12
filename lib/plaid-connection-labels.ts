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
  isoCurrencyCode?: string | null
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

/**
 * Balance phrase for a connection row. Credit cards show what is owed.
 * Returns null until Plaid has sent a balance.
 */
export function formatPlaidAccountBalance(account: PlaidAccountBalanceSummary): string | null {
  const current = account.currentBalance
  if (current == null || !Number.isFinite(current)) return null
  const currency = account.isoCurrencyCode?.trim().toUpperCase() || "USD"
  if (currency !== "USD") return null
  if (account.type === "credit") return `${formatUsd(current)} owed`
  return formatUsd(current)
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
