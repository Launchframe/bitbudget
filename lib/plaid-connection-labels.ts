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
