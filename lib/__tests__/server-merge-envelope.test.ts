// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { mergeEnvelopeRecords, rewriteDistributionConfigForMerge } from "@/lib/server-merge-envelope"

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe("rewriteDistributionConfigForMerge", () => {
  const FROM = "env_from"
  const TO = "env_to"
  const OTHER = "env_other"

  it("returns the same reference when fromId is not present in a rebalance config", () => {
    const config = { mode: "balanced", entries: [{ envelopeId: OTHER, deltaUsd: 50 }] }
    expect(rewriteDistributionConfigForMerge(config, FROM, TO)).toBe(config)
  })

  it("returns the same reference when config has no entries or customByEnvelopeId", () => {
    const config = { distributionBehavior: "set_to_budget", fundOverageFromSavings: true }
    expect(rewriteDistributionConfigForMerge(config, FROM, TO)).toBe(config)
  })

  it("returns original for null / non-object inputs", () => {
    expect(rewriteDistributionConfigForMerge(null, FROM, TO)).toBeNull()
    expect(rewriteDistributionConfigForMerge("string", FROM, TO)).toBe("string")
    expect(rewriteDistributionConfigForMerge(42, FROM, TO)).toBe(42)
  })

  // ── rebalance entries ──────────────────────────────────────────────────────

  it("renames fromId to toId in rebalance entries", () => {
    const config = {
      mode: "independent",
      entries: [
        { envelopeId: FROM, deltaUsd: 100 },
        { envelopeId: OTHER, deltaUsd: -50 },
      ],
    }
    const result = rewriteDistributionConfigForMerge(config, FROM, TO) as {
      mode: string
      entries: { envelopeId: string; deltaUsd: number }[]
    }
    expect(result).not.toBe(config)
    expect(result.entries).toEqual(
      expect.arrayContaining([
        { envelopeId: TO, deltaUsd: 100 },
        { envelopeId: OTHER, deltaUsd: -50 },
      ]),
    )
    expect(result.entries.find((e) => e.envelopeId === FROM)).toBeUndefined()
  })

  it("merges deltaUsd when both fromId and toId are present in rebalance entries", () => {
    const config = {
      mode: "independent",
      entries: [
        { envelopeId: FROM, deltaUsd: 75 },
        { envelopeId: TO, deltaUsd: 25 },
        { envelopeId: OTHER, deltaUsd: -100 },
      ],
    }
    const result = rewriteDistributionConfigForMerge(config, FROM, TO) as {
      entries: { envelopeId: string; deltaUsd: number }[]
    }
    const toEntry = result.entries.find((e) => e.envelopeId === TO)
    expect(toEntry?.deltaUsd).toBe(100) // 75 + 25
    expect(result.entries.find((e) => e.envelopeId === FROM)).toBeUndefined()
  })

  it("preserves other top-level fields in rebalance config", () => {
    const config = {
      mode: "balanced",
      entries: [{ envelopeId: FROM, deltaUsd: 50 }],
      someExtra: "value",
    }
    const result = rewriteDistributionConfigForMerge(config, FROM, TO) as Record<string, unknown>
    expect(result.mode).toBe("balanced")
    expect(result.someExtra).toBe("value")
  })

  // ── income_distribution customByEnvelopeId ─────────────────────────────────

  it("renames fromId key in customByEnvelopeId", () => {
    const config = {
      distributionBehavior: "custom",
      fundOverageFromSavings: true,
      customByEnvelopeId: { [FROM]: 200, [OTHER]: 100 },
    }
    const result = rewriteDistributionConfigForMerge(config, FROM, TO) as {
      customByEnvelopeId: Record<string, number>
    }
    expect(result.customByEnvelopeId[TO]).toBe(200)
    expect(result.customByEnvelopeId[FROM]).toBeUndefined()
    expect(result.customByEnvelopeId[OTHER]).toBe(100)
  })

  it("sums amounts when both fromId and toId exist in customByEnvelopeId", () => {
    const config = {
      distributionBehavior: "custom",
      fundOverageFromSavings: false,
      customByEnvelopeId: { [FROM]: 150, [TO]: 50, [OTHER]: 75 },
    }
    const result = rewriteDistributionConfigForMerge(config, FROM, TO) as {
      customByEnvelopeId: Record<string, number>
    }
    expect(result.customByEnvelopeId[TO]).toBe(200) // 150 + 50
    expect(result.customByEnvelopeId[FROM]).toBeUndefined()
    expect(result.customByEnvelopeId[OTHER]).toBe(75)
  })

  it("returns original when fromId is not in customByEnvelopeId", () => {
    const config = {
      distributionBehavior: "custom",
      fundOverageFromSavings: true,
      customByEnvelopeId: { [TO]: 200, [OTHER]: 100 },
    }
    expect(rewriteDistributionConfigForMerge(config, FROM, TO)).toBe(config)
  })
})

// ─── mergeEnvelopeRecords ─────────────────────────────────────────────────────

describe("mergeEnvelopeRecords", () => {
  const userId = "user_1"
  const fromId = "env_from"
  const toId = "env_to"

  const txEnvelopeFindFirst = vi.fn()
  const txTransactionUpdateMany = vi.fn()
  const txRecurringUpdateMany = vi.fn()
  const txPendingUpdateMany = vi.fn()
  const txShortcutUpdateMany = vi.fn()
  const txMappingUpdateMany = vi.fn()
  const txEnvelopeUpdate = vi.fn()
  const txEnvelopeDelete = vi.fn()
  const txFundingRuleFindMany = vi.fn()
  const txFundingRuleUpdate = vi.fn()

  const tx = {
    envelope: {
      findFirst: txEnvelopeFindFirst,
      update: txEnvelopeUpdate,
      delete: txEnvelopeDelete,
    },
    transaction: { updateMany: txTransactionUpdateMany },
    recurringTransaction: { updateMany: txRecurringUpdateMany },
    pendingTransaction: { updateMany: txPendingUpdateMany },
    transactionShortcut: { updateMany: txShortcutUpdateMany },
    payeeEnvelopeMapping: { updateMany: txMappingUpdateMany },
    recurringFundingRule: {
      findMany: txFundingRuleFindMany,
      update: txFundingRuleUpdate,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    txEnvelopeFindFirst.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === fromId) {
        return Promise.resolve({ id: fromId, userId, monthlyAllotment: 40 })
      }
      if (where.id === toId) {
        return Promise.resolve({ id: toId, userId, monthlyAllotment: 60 })
      }
      return Promise.resolve(null)
    })
    txTransactionUpdateMany.mockResolvedValue({ count: 2 })
    txRecurringUpdateMany.mockResolvedValue({ count: 1 })
    txPendingUpdateMany.mockResolvedValue({ count: 0 })
    txShortcutUpdateMany.mockResolvedValue({ count: 1 })
    txMappingUpdateMany.mockResolvedValue({ count: 0 })
    txEnvelopeUpdate.mockResolvedValue({})
    txEnvelopeDelete.mockResolvedValue({})
    txFundingRuleFindMany.mockResolvedValue([])
    txFundingRuleUpdate.mockResolvedValue({})
  })

  it("migrates all related records and combines allotments before deleting source", async () => {
    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txTransactionUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txRecurringUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txPendingUpdateMany).toHaveBeenCalledWith({
      where: { userId, suggestedEnvelopeId: fromId },
      data: { suggestedEnvelopeId: toId },
    })
    expect(txShortcutUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txMappingUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txEnvelopeUpdate).toHaveBeenCalledWith({
      where: { id: toId },
      data: { monthlyAllotment: 100 },
    })
    expect(txEnvelopeDelete).toHaveBeenCalledWith({ where: { id: fromId } })
  })

  it("is a no-op when source and target are the same envelope", async () => {
    await mergeEnvelopeRecords(tx as never, userId, fromId, fromId)

    expect(txEnvelopeFindFirst).not.toHaveBeenCalled()
    expect(txTransactionUpdateMany).not.toHaveBeenCalled()
    expect(txEnvelopeDelete).not.toHaveBeenCalled()
  })

  it("is a no-op when the source envelope does not belong to the user", async () => {
    txEnvelopeFindFirst.mockResolvedValue(null)

    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txTransactionUpdateMany).not.toHaveBeenCalled()
    expect(txEnvelopeDelete).not.toHaveBeenCalled()
  })

  // ── RecurringFundingRule distributionConfig rewriting ─────────────────────

  it("BUG REGRESSION: updates rebalance rule distributionConfig to replace fromId with toId", async () => {
    const ruleId = "rule_1"
    const staleConfig = {
      mode: "independent",
      entries: [{ envelopeId: fromId, deltaUsd: 80 }],
    }
    txFundingRuleFindMany.mockResolvedValue([{ id: ruleId, distributionConfig: staleConfig }])

    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txFundingRuleUpdate).toHaveBeenCalledWith({
      where: { id: ruleId },
      data: {
        distributionConfig: {
          mode: "independent",
          entries: [{ envelopeId: toId, deltaUsd: 80 }],
        },
      },
    })
  })

  it("updates income_distribution customByEnvelopeId to replace fromId key with toId key", async () => {
    const ruleId = "rule_2"
    const staleConfig = {
      distributionBehavior: "custom",
      fundOverageFromSavings: true,
      customByEnvelopeId: { [fromId]: 200, "env_other": 50 },
    }
    txFundingRuleFindMany.mockResolvedValue([{ id: ruleId, distributionConfig: staleConfig }])

    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    const updateCall = txFundingRuleUpdate.mock.calls[0]?.[0] as {
      data: { distributionConfig: { customByEnvelopeId: Record<string, number> } }
    }
    expect(updateCall.data.distributionConfig.customByEnvelopeId[toId]).toBe(200)
    expect(updateCall.data.distributionConfig.customByEnvelopeId[fromId]).toBeUndefined()
    expect(updateCall.data.distributionConfig.customByEnvelopeId["env_other"]).toBe(50)
  })

  it("does not update a rule whose config does not reference fromId", async () => {
    const ruleId = "rule_3"
    const config = {
      mode: "balanced",
      entries: [{ envelopeId: "env_unrelated", deltaUsd: 30 }],
    }
    txFundingRuleFindMany.mockResolvedValue([{ id: ruleId, distributionConfig: config }])

    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txFundingRuleUpdate).not.toHaveBeenCalled()
  })

  it("does not update rules when there are none", async () => {
    txFundingRuleFindMany.mockResolvedValue([])

    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txFundingRuleUpdate).not.toHaveBeenCalled()
  })

  it("queries funding rules scoped to the correct user", async () => {
    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txFundingRuleFindMany).toHaveBeenCalledWith({
      where: { userId },
      select: { id: true, distributionConfig: true },
    })
  })
})
