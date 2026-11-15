import { getBtcPriceForDate, getCurrentBtcPrice } from "@/lib/btc-price"
import {
  parseReferenceAsset,
  type ReferenceAsset,
} from "@/lib/reference-asset"
import { transactionCalendarDay } from "@/lib/transaction-dates"
import { getCurrentXbtPrice, getXbtPriceForDate } from "@/lib/xbt-price"

/**
 * USD mark for the active Bitcoin ticker on a calendar day (YYYY-MM-DD).
 * XBT never falls back to BTC; pre-listing / missing days return null.
 * When `date` is a storage instant, it is normalized via `transactionCalendarDay`.
 */
export async function referencePriceUsdForAsset(
  asset: ReferenceAsset,
  date?: string,
): Promise<number | null> {
  const day = date !== undefined ? transactionCalendarDay(date) : undefined

  if (asset === "xbt") {
    if (day) return getXbtPriceForDate(day)
    const price = await getCurrentXbtPrice()
    return price > 0 ? price : null
  }

  if (day) return getBtcPriceForDate(day)
  const price = await getCurrentBtcPrice()
  return price > 0 ? price : null
}

/**
 * Resolve the USD Bitcoin mark for runway (and similar) from the user’s
 * `referenceAsset`. Pass the result as `btcPriceUsd` into existing runway
 * helpers — formulas stay ticker-agnostic.
 */
export async function referencePriceForUser(
  user: { referenceAsset?: string | null },
  date?: string,
): Promise<number | null> {
  return referencePriceUsdForAsset(parseReferenceAsset(user.referenceAsset), date)
}
