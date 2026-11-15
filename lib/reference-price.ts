import { getBtcPriceForDate, getCurrentBtcPrice } from "@/lib/btc-price"
import {
  parseReferenceAsset,
  type ReferenceAsset,
} from "@/lib/reference-asset"
import { getCurrentXbtPrice, getXbtPriceForDate } from "@/lib/xbt-price"

/**
 * USD mark for the active Bitcoin ticker on a calendar day (YYYY-MM-DD).
 * XBT never falls back to BTC; pre-listing / missing days return null.
 */
export async function referencePriceUsdForAsset(
  asset: ReferenceAsset,
  date?: string,
): Promise<number | null> {
  if (asset === "xbt") {
    if (date) return getXbtPriceForDate(date)
    const price = await getCurrentXbtPrice()
    return price > 0 ? price : null
  }

  if (date) return getBtcPriceForDate(date)
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
