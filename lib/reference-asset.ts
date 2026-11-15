/** Which Bitcoin ticker Opportunity Cost / charts use when OC is on. */
export type ReferenceAsset = "btc" | "xbt"

export const DEFAULT_REFERENCE_ASSET: ReferenceAsset = "btc"

export function isReferenceAsset(value: unknown): value is ReferenceAsset {
  return value === "btc" || value === "xbt"
}

/** Coerce API/session values; unknown → default BTC. */
export function parseReferenceAsset(value: unknown): ReferenceAsset {
  return isReferenceAsset(value) ? value : DEFAULT_REFERENCE_ASSET
}

/** sessionStorage `onboardingSource` → OC on/off and ticker. */
export type OnboardingSource = "vanilla" | "btc" | "xbt"

export function parseOnboardingSource(value: unknown): OnboardingSource {
  if (value === "btc" || value === "xbt" || value === "vanilla") return value
  return "vanilla"
}

export function opportunityCostFromOnboardingSource(source: OnboardingSource): boolean {
  return source === "btc" || source === "xbt"
}

export function referenceAssetFromOnboardingSource(source: OnboardingSource): ReferenceAsset {
  return source === "xbt" ? "xbt" : "btc"
}
