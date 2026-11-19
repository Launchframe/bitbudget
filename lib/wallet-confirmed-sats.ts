/**
 * Confirmed bitcoin a Runway plan can count, summed on the client.
 *
 * Wallet material (xpub, address) never comes through here as a server payload.
 * Coins that are still bitcoin on the way live in that placeholder. If an
 * exchange watch still shows those same coins, they are removed from this
 * total so they are not counted twice. Once the sale is cash on the way, pass
 * 0 for that argument. A wallet that already dropped the send is left as-is.
 *
 * Chain activity is not spending and not income until the user marks a spend.
 * Posting collateral, a collateral return, and "sent to sell" stay off both.
 */

export type WatchRole = "wallet" | "exchange" | "address"

export type ChainActivityPurpose =
  | "uncategorized"
  | "spend"
  | "collateral_post"
  | "collateral_return"
  | "sent_to_sell"

export interface ConfirmedWatch {
  confirmedSats: number
  role: WatchRole | string
}

export function sumConfirmedSats(watches: readonly { confirmedSats: number }[]): number {
  let sum = 0
  for (const watch of watches) {
    const sats = watch.confirmedSats
    if (!Number.isFinite(sats) || sats <= 0) continue
    sum += Math.round(sats)
  }
  return sum
}

/**
 * Sats Runway should treat as bitcoin you hold.
 * `bitcoinOnTheWaySats` is the placeholder for a sale that is still bitcoin
 * (status `sent`). Only that portion of an exchange watch is subtracted, so
 * those coins live in the placeholder. A sale that has already become cash
 * on the way must pass 0 — a refreshed exchange balance is not reduced again.
 * A self-custody watch that already dropped the send is left as-is.
 */
export function runwayWalletSats(
  watches: readonly ConfirmedWatch[],
  bitcoinOnTheWaySats: number,
): number {
  const raw = sumConfirmedSats(watches)
  const exchange = sumConfirmedSats(watches.filter((watch) => watch.role === "exchange"))
  const onTheWay = Number.isFinite(bitcoinOnTheWaySats)
    ? Math.max(0, Math.round(bitcoinOnTheWaySats))
    : 0
  const overlap = Math.min(exchange, onTheWay)
  return Math.max(0, raw - overlap)
}

/**
 * True when the bitcoin line can say the total came from watched wallets.
 * A watch that was saved but never read (no balance, no timestamp) does not.
 */
export function walletWatchInformsHoldings(
  watches: readonly { confirmedSats: number; updatedAt?: string | null }[],
): boolean {
  return watches.some((watch) => {
    if (typeof watch.updatedAt === "string" && watch.updatedAt.length > 0) return true
    return Number.isFinite(watch.confirmedSats) && watch.confirmedSats > 0
  })
}

/** True only when the user has categorized the chain row as spending. */
export function chainActivityCountsAsSpending(purpose: ChainActivityPurpose): boolean {
  return purpose === "spend"
}

/**
 * Chain rows are never income. A collateral return and a sale's coins are
 * stack moves. Cash from a sale lands as the linked deposit, not as this row.
 */
export function chainActivityCountsAsIncome(purpose: ChainActivityPurpose): boolean {
  switch (purpose) {
    case "uncategorized":
    case "spend":
    case "collateral_post":
    case "collateral_return":
    case "sent_to_sell":
      return false
    default: {
      const unreachable: never = purpose
      return unreachable
    }
  }
}
