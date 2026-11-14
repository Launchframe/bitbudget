/**
 * Confirmed bitcoin a Runway plan can count, summed on the client.
 *
 * Wallet material (xpub, address) never comes through here as a server payload.
 * An open sale's coins live in the sale placeholder. If an exchange watch still
 * shows those same coins, they are removed from this total so they are not
 * counted twice. A wallet that already dropped the send is left as-is.
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
 * `reservedForSaleSats` is the open-sale placeholder. Only the portion still
 * visible on an exchange watch is subtracted.
 */
export function runwayWalletSats(
  watches: readonly ConfirmedWatch[],
  reservedForSaleSats: number,
): number {
  const raw = sumConfirmedSats(watches)
  const exchange = sumConfirmedSats(watches.filter((watch) => watch.role === "exchange"))
  const reserved = Number.isFinite(reservedForSaleSats) ? Math.max(0, Math.round(reservedForSaleSats)) : 0
  const overlap = Math.min(exchange, reserved)
  return Math.max(0, raw - overlap)
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
