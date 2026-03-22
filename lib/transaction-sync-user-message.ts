/** Map caught errors to short, user-safe copy; log the raw value separately in callers. */
export function transactionSyncUserMessage(err: unknown): string {
  if (err instanceof TypeError) {
    return "Something went wrong loading data. Check your connection and try again."
  }
  if (err instanceof Error) {
    const m = err.message
    if (/Failed to fetch|NetworkError|network|load failed|fetch/i.test(m)) {
      return "Could not reach the server. Check your connection and try again."
    }
    if (/401|403|Unauthorized|unauthorized/i.test(m)) {
      return "Your session may have expired. Sign in again if this continues."
    }
    if (/Failed to fetch (tags|data|transactions|envelopes|settings)/i.test(m)) {
      return "Could not load your account data. Try again in a moment."
    }
  }
  return "Could not refresh transactions. Try again in a moment."
}
