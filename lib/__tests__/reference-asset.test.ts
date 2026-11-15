import { describe, expect, it } from "vitest"
import {
  DEFAULT_REFERENCE_ASSET,
  opportunityCostFromOnboardingSource,
  parseOnboardingSource,
  parseReferenceAsset,
  referenceAssetFromOnboardingSource,
} from "@/lib/reference-asset"

describe("parseReferenceAsset", () => {
  it("accepts btc and xbt", () => {
    expect(parseReferenceAsset("btc")).toBe("btc")
    expect(parseReferenceAsset("xbt")).toBe("xbt")
  })

  it("defaults unknown values to btc", () => {
    expect(parseReferenceAsset(undefined)).toBe(DEFAULT_REFERENCE_ASSET)
    expect(parseReferenceAsset("eth")).toBe("btc")
    expect(parseReferenceAsset(null)).toBe("btc")
  })
})

describe("onboardingSource helpers", () => {
  it("parses known sources", () => {
    expect(parseOnboardingSource("xbt")).toBe("xbt")
    expect(parseOnboardingSource("btc")).toBe("btc")
    expect(parseOnboardingSource("vanilla")).toBe("vanilla")
    expect(parseOnboardingSource("other")).toBe("vanilla")
  })

  it("maps source to OC flag and ticker", () => {
    expect(opportunityCostFromOnboardingSource("vanilla")).toBe(false)
    expect(opportunityCostFromOnboardingSource("btc")).toBe(true)
    expect(opportunityCostFromOnboardingSource("xbt")).toBe(true)
    expect(referenceAssetFromOnboardingSource("vanilla")).toBe("btc")
    expect(referenceAssetFromOnboardingSource("btc")).toBe("btc")
    expect(referenceAssetFromOnboardingSource("xbt")).toBe("xbt")
  })
})
