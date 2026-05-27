export const PLAID_CONNECT_RETRY_TITLE = "Hmm, looks like that didn't quite work."

export const PLAID_CONNECT_RETRY_DEFAULT =
  "Let's try again. This can happen if the bank connection screen was open for a while."

export const PLAID_CONNECT_RETRY_SESSION =
  "Your BitBudget session timed out. Sign in again, then try connecting your bank."

interface PlaidLinkExitError {
  error_code?: string
  display_message?: string
  error_message?: string
}

/** Map Plaid API errors from the Node SDK into user-facing copy. */
export function plaidApiErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("response" in err)) return null
  const data = (err as { response?: { data?: PlaidLinkExitError } }).response?.data
  if (!data) return null
  return plaidConnectFailureMessage({ exitError: data })
}

export function plaidConnectFailureMessage(options: {
  httpStatus?: number
  serverMessage?: string
  exitError?: PlaidLinkExitError | null
}): string {
  const { httpStatus, serverMessage, exitError } = options

  if (httpStatus === 401) {
    return PLAID_CONNECT_RETRY_SESSION
  }

  const exitCode = exitError?.error_code?.toUpperCase()
  if (
    exitCode === "INVALID_LINK_TOKEN" ||
    exitCode === "INVALID_PUBLIC_TOKEN" ||
    exitCode === "ITEM_LOGIN_REQUIRED"
  ) {
    return "That connection timed out. Let's try again with a fresh link."
  }

  if (typeof serverMessage === "string" && serverMessage.trim()) {
    return serverMessage.trim()
  }

  const display = exitError?.display_message?.trim() || exitError?.error_message?.trim()
  if (display) {
    return display
  }

  return PLAID_CONNECT_RETRY_DEFAULT
}

export function plaidLinkExitErrorMessage(err: PlaidLinkExitError | null | undefined): string {
  return plaidConnectFailureMessage({ exitError: err ?? null })
}
