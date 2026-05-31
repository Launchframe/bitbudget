import { describe, expect, it } from "vitest"
import {
  buildPayeeDisplayRowsFromTransactions,
  collapsePayeeSoftKey,
  filterClusterIgnoredVariants,
  findSimilarPayeeClusters,
  getPayeeRuleReviewClusters,
  isClusterResolvedByRules,
  matchLongestRule,
  mergePayeeCandidates,
  normalizePayeeKey,
  resolveCanonicalPayee,
  type PayeeNameRule,
  type PayeeCandidate,
} from "@/lib/payee-canonical"

describe("normalizePayeeKey", () => {
  it("trims and lowercases", () => {
    expect(normalizePayeeKey("  Last War  ")).toBe("last war")
  })

  it("strips trailing store numbers", () => {
    expect(normalizePayeeKey("Target #1234")).toBe("target")
  })
})

describe("collapsePayeeSoftKey", () => {
  it("merges Wal-Mart and Walmart forms", () => {
    expect(collapsePayeeSoftKey("Wal-Mart")).toBe("walmart")
    expect(collapsePayeeSoftKey("Walmart")).toBe("walmart")
    expect(collapsePayeeSoftKey("WAL MART")).toBe("walmart")
  })

  it("does not collapse Walmart Pharmacy into Walmart", () => {
    expect(collapsePayeeSoftKey("Walmart")).toBe("walmart")
    expect(collapsePayeeSoftKey("Walmart Pharmacy")).toBe("walmartpharmacy")
  })
})

describe("matchLongestRule", () => {
  const rules: PayeeNameRule[] = [
    { sourceNormalized: "wm", canonicalPayee: "Bad" },
    { sourceNormalized: "wm supercenter", canonicalPayee: "Walmart" },
  ]

  it("returns longest matching rule prefix", () => {
    const hit = matchLongestRule("WM SUPERCENTER 1234", rules)
    expect(hit?.canonicalPayee).toBe("Walmart")
  })

  it("matches exact normalized source", () => {
    const hit = matchLongestRule("WM SUPERCENTER", [
      { sourceNormalized: "wm supercenter", canonicalPayee: "Walmart" },
    ])
    expect(hit?.canonicalPayee).toBe("Walmart")
  })

  // Pass 2: soft-equal fallback — the core fix for the normalization bug
  it("soft-equal pass: fires wal-mart rule for Walmart input", () => {
    // An existing rule keyed as "wal-mart" should also fire when receipt says "Walmart"
    const hit = matchLongestRule("Walmart", [
      { sourceNormalized: "wal-mart", canonicalPayee: "Walmart" },
    ])
    expect(hit?.canonicalPayee).toBe("Walmart")
  })

  it("exact pass wins over soft pass when exact key matches", () => {
    const exact: PayeeNameRule = { sourceNormalized: "wal-mart", canonicalPayee: "Walmart" }
    const hit = matchLongestRule("Wal-Mart", [exact])
    expect(hit?.canonicalPayee).toBe("Walmart")
  })

  it("soft-equal pass returns null when no soft match exists", () => {
    const hit = matchLongestRule("Starbucks", [
      { sourceNormalized: "wal-mart", canonicalPayee: "Walmart" },
    ])
    expect(hit).toBeNull()
  })

  it("soft-equal picks longest matching rule when multiple soft-match", () => {
    // "wal mart stores" (longer) should beat "wal mart" when input collapses to "walmart..."
    const hit = matchLongestRule("WAL MART STORES", [
      { sourceNormalized: "wal mart", canonicalPayee: "Short" },
      { sourceNormalized: "wal mart stores", canonicalPayee: "Long" },
    ])
    expect(hit?.canonicalPayee).toBe("Long")
  })
})

describe("resolveCanonicalPayee", () => {
  const candidates: PayeeCandidate[] = [
    { displayName: "Last War", count: 50 },
    { displayName: "Amazon", count: 10 },
    { displayName: "Walmart", count: 30 },
    { displayName: "Walmart Pharmacy", count: 5 },
  ]

  it("does not auto-merge Last War Survival to Last War (use aliases)", () => {
    expect(resolveCanonicalPayee("Last War Survival", candidates)).toBeNull()
  })

  it("does not merge Walmart Pharmacy into Walmart via prefix", () => {
    expect(resolveCanonicalPayee("Walmart Pharmacy", candidates)).toBeNull()
  })

  it("maps Wal-Mart receipt to Walmart via soft-equal", () => {
    const r = resolveCanonicalPayee("Wal-Mart", candidates)
    expect(r).toMatchObject({
      canonicalPayee: "Walmart",
      reason: "soft-equal",
    })
  })

  it("maps Wal-Mart store number to Walmart via soft-equal", () => {
    const r = resolveCanonicalPayee("Wal-Mart #4021", candidates)
    expect(r).toMatchObject({
      canonicalPayee: "Walmart",
      reason: "soft-equal",
    })
  })

  it("prefers user rule for Last War Survival", () => {
    const rules: PayeeNameRule[] = [
      { sourceNormalized: "last war survival", canonicalPayee: "Last War" },
    ]
    const r = resolveCanonicalPayee("Last War Survival", candidates, rules)
    expect(r).toMatchObject({
      canonicalPayee: "Last War",
      reason: "alias",
    })
  })

  it("prefers user rule over history for WM SUPERCENTER", () => {
    const rules: PayeeNameRule[] = [
      { sourceNormalized: "wm supercenter", canonicalPayee: "Walmart" },
    ]
    const r = resolveCanonicalPayee("WM SUPERCENTER", [{ displayName: "Other", count: 1 }], rules)
    expect(r).toMatchObject({
      canonicalPayee: "Walmart",
      reason: "alias",
    })
  })

  it("returns null when extracted equals candidate", () => {
    expect(resolveCanonicalPayee("Last War", candidates)).toBeNull()
  })

  it("returns null for no match", () => {
    expect(resolveCanonicalPayee("Totally Different LLC", candidates)).toBeNull()
  })

  it("ignores candidates shorter than minimum length", () => {
    const short: PayeeCandidate[] = [{ displayName: "AB", count: 99 }]
    expect(resolveCanonicalPayee("AB Something", short)).toBeNull()
  })

  it("does not match interior substring", () => {
    const r = resolveCanonicalPayee("Buy Amazon Now", [{ displayName: "Amazon", count: 10 }])
    expect(r).toBeNull()
  })

  it("returns null when rule canonical is identical trimmed string to extract", () => {
    const rules: PayeeNameRule[] = [
      { sourceNormalized: "wm supercenter", canonicalPayee: "WM SUPERCENTER" },
    ]
    const r = resolveCanonicalPayee("WM SUPERCENTER", [], rules)
    expect(r).toBeNull()
  })

  it("applies rule for preferred casing when normalized extract matches source", () => {
    const rules: PayeeNameRule[] = [
      { sourceNormalized: "walmart", canonicalPayee: "Walmart" },
    ]
    const r = resolveCanonicalPayee("WALMART", [], rules)
    expect(r).toMatchObject({
      canonicalPayee: "Walmart",
      reason: "alias",
    })
  })

  it("soft-equal rewrites casing when raw extract differs from stored payee", () => {
    const r = resolveCanonicalPayee("WALMART", [{ displayName: "Walmart", count: 5 }])
    expect(r).toMatchObject({
      canonicalPayee: "Walmart",
      reason: "soft-equal",
    })
  })
})

describe("findSimilarPayeeClusters", () => {
  it("groups Wal-Mart and Walmart", () => {
    const clusters = findSimilarPayeeClusters([
      { displayName: "Walmart", count: 20 },
      { displayName: "Wal-Mart", count: 3 },
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].variants.map((v) => v.displayName).sort()).toEqual(["Wal-Mart", "Walmart"])
  })

  it("does not group Walmart and Walmart Pharmacy", () => {
    const clusters = findSimilarPayeeClusters([
      { displayName: "Walmart", count: 20 },
      { displayName: "Walmart Pharmacy", count: 5 },
    ])
    expect(clusters).toHaveLength(0)
  })
})

describe("isClusterResolvedByRules", () => {
  it("returns true when non-canonical variants map to canonical", () => {
    const clusters = findSimilarPayeeClusters([
      { displayName: "Walmart", count: 20 },
      { displayName: "Wal-Mart", count: 3 },
    ])
    const c = clusters[0]!
    const rules: PayeeNameRule[] = [
      { sourceNormalized: normalizePayeeKey("Wal-Mart"), canonicalPayee: "Walmart" },
    ]
    expect(isClusterResolvedByRules(c, rules)).toBe(true)
  })

  it("returns false without rules", () => {
    const clusters = findSimilarPayeeClusters([
      { displayName: "Walmart", count: 20 },
      { displayName: "Wal-Mart", count: 3 },
    ])
    expect(isClusterResolvedByRules(clusters[0]!, [])).toBe(false)
  })
})

describe("filterClusterIgnoredVariants", () => {
  it("returns null when only one variant remains", () => {
    const clusters = findSimilarPayeeClusters([
      { displayName: "Walmart", count: 20 },
      { displayName: "Wal-Mart", count: 3 },
    ])
    const c = clusters[0]!
    const ignored = new Set([normalizePayeeKey("Wal-Mart")])
    expect(filterClusterIgnoredVariants(c, ignored)).toBeNull()
  })
})

describe("getPayeeRuleReviewClusters", () => {
  it("drops resolved and fully ignored clusters", () => {
    const clusters = findSimilarPayeeClusters([
      { displayName: "Walmart", count: 20 },
      { displayName: "Wal-Mart", count: 3 },
    ])
    const rules: PayeeNameRule[] = [
      { sourceNormalized: normalizePayeeKey("Wal-Mart"), canonicalPayee: "Walmart" },
    ]
    expect(getPayeeRuleReviewClusters(clusters, rules, new Set())).toHaveLength(0)

    const pending = getPayeeRuleReviewClusters(clusters, [], new Set())
    expect(pending).toHaveLength(1)
  })
})

describe("buildPayeeDisplayRowsFromTransactions", () => {
  it("aggregates payees like settings", () => {
    const rows = buildPayeeDisplayRowsFromTransactions([
      { payee: "Walmart" },
      { payee: "walmart" },
      { payee: "Wal-Mart" },
    ])
    expect(rows.find((r) => r.displayName === "Walmart")?.count).toBe(2)
    expect(rows.find((r) => r.displayName === "Wal-Mart")?.count).toBe(1)
  })
})

describe("mergePayeeCandidates", () => {
  it("sums counts for same payee different casing", () => {
    const merged = mergePayeeCandidates([
      { displayName: "Last War", count: 10 },
      { displayName: "last war", count: 5 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].count).toBe(15)
    expect(merged[0].displayName).toBe("Last War")
  })

  it("picks the higher-frequency spelling as representative", () => {
    const merged = mergePayeeCandidates([
      { displayName: "walmart", count: 2 },
      { displayName: "Walmart", count: 10 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].count).toBe(12)
    expect(merged[0].displayName).toBe("Walmart")
  })
})
