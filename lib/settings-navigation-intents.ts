/** Set before navigating to Envelopes; cleared when Adjust → Rebalance opens. */
export const OPEN_REBALANCE_INTENT_KEY = "bitbudget-open-rebalance"

export function setOpenRebalanceIntent(): void {
  try {
    sessionStorage.setItem(OPEN_REBALANCE_INTENT_KEY, "1")
  } catch {
    /* ignore */
  }
}

export function consumeOpenRebalanceIntent(): boolean {
  try {
    if (sessionStorage.getItem(OPEN_REBALANCE_INTENT_KEY) === "1") {
      sessionStorage.removeItem(OPEN_REBALANCE_INTENT_KEY)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}
