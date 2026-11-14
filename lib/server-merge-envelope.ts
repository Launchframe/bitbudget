import type { Prisma } from "@prisma/client"

/**
 * Rewrites envelope ID references inside a RecurringFundingRule.distributionConfig JSON blob,
 * replacing every occurrence of `fromId` with `toId`.
 *
 * Handled shapes:
 *  - rebalance / move_funds: `{ entries: [{ envelopeId, deltaUsd }] }`
 *    → renames matching entries; merges deltaUsd when toId already present.
 *  - income_distribution with custom behavior: `{ customByEnvelopeId: { [envelopeId]: amount } }`
 *    → renames the key; sums amounts when toId already present.
 *
 * Returns the original value unchanged when no reference to `fromId` is found.
 */
export function rewriteDistributionConfigForMerge(
  config: Prisma.JsonValue,
  fromId: string,
  toId: string,
): Prisma.JsonValue {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return config
  const c = config as Record<string, Prisma.JsonValue>

  // ── rebalance / move_funds ──────────────────────────────────────────────────
  if (Array.isArray(c.entries)) {
    // Collect entries by envelopeId so we can merge when both fromId and toId exist.
    const merged: Record<string, number> = {}
    let sawFrom = false
    for (const entry of c.entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue
      const e = entry as Record<string, Prisma.JsonValue>
      const eid = typeof e.envelopeId === "string" ? e.envelopeId : null
      if (!eid) continue
      const delta = typeof e.deltaUsd === "number" ? e.deltaUsd : 0
      const mappedId = eid === fromId ? toId : eid
      if (eid === fromId) sawFrom = true
      merged[mappedId] = (merged[mappedId] ?? 0) + delta
    }

    if (sawFrom) {
      const newEntries = Object.entries(merged).map(([envelopeId, deltaUsd]) => ({
        envelopeId,
        deltaUsd: Math.round(deltaUsd * 100) / 100,
      }))
      return { ...c, entries: newEntries }
    }
  }

  // ── income_distribution with customByEnvelopeId ────────────────────────────
  if (
    typeof c.customByEnvelopeId === "object" &&
    c.customByEnvelopeId !== null &&
    !Array.isArray(c.customByEnvelopeId)
  ) {
    const custom = c.customByEnvelopeId as Record<string, Prisma.JsonValue>
    if (fromId in custom) {
      const newCustom: Record<string, Prisma.JsonValue> = {}
      for (const [k, v] of Object.entries(custom)) {
        const mappedKey = k === fromId ? toId : k
        if (mappedKey in newCustom) {
          // Both fromId and toId present — sum the amounts.
          const prev = typeof newCustom[mappedKey] === "number" ? (newCustom[mappedKey] as number) : 0
          const add = typeof v === "number" ? v : 0
          newCustom[mappedKey] = Math.round((prev + add) * 100) / 100
        } else {
          newCustom[mappedKey] = v
        }
      }
      return { ...c, customByEnvelopeId: newCustom }
    }
  }

  return config
}

/** Move all references from `fromEnvelopeId` onto `intoEnvelopeId`, combine allotments, delete source. */
export async function mergeEnvelopeRecords(
  tx: Prisma.TransactionClient,
  userId: string,
  fromEnvelopeId: string,
  intoEnvelopeId: string,
): Promise<void> {
  if (fromEnvelopeId === intoEnvelopeId) return

  const [fromE, toE] = await Promise.all([
    tx.envelope.findFirst({ where: { id: fromEnvelopeId, userId } }),
    tx.envelope.findFirst({ where: { id: intoEnvelopeId, userId } }),
  ])
  if (!fromE || !toE) return

  await tx.transaction.updateMany({
    where: { userId, envelopeId: fromEnvelopeId },
    data: { envelopeId: intoEnvelopeId },
  })
  await tx.recurringTransaction.updateMany({
    where: { userId, envelopeId: fromEnvelopeId },
    data: { envelopeId: intoEnvelopeId },
  })
  await tx.pendingTransaction.updateMany({
    where: { userId, suggestedEnvelopeId: fromEnvelopeId },
    data: { suggestedEnvelopeId: intoEnvelopeId },
  })
  await tx.transactionShortcut.updateMany({
    where: { userId, envelopeId: fromEnvelopeId },
    data: { envelopeId: intoEnvelopeId },
  })
  await tx.payeeEnvelopeMapping.updateMany({
    where: { userId, envelopeId: fromEnvelopeId },
    data: { envelopeId: intoEnvelopeId },
  })

  await tx.envelope.update({
    where: { id: intoEnvelopeId },
    data: { monthlyAllotment: toE.monthlyAllotment + fromE.monthlyAllotment },
  })

  // Rewrite envelope IDs embedded in RecurringFundingRule.distributionConfig JSON.
  // The schema stores envelope references inside JSON, not as FK columns, so Prisma
  // cascade-on-delete does not fire. Without this step the rule silently becomes a
  // no-op (rebalance entries for the deleted ID are filtered out) or drops the
  // custom income-distribution amount for that envelope.
  const fundingRules = await tx.recurringFundingRule.findMany({
    where: { userId },
    select: { id: true, distributionConfig: true },
  })
  for (const rule of fundingRules) {
    const rewritten = rewriteDistributionConfigForMerge(
      rule.distributionConfig,
      fromEnvelopeId,
      intoEnvelopeId,
    )
    if (rewritten !== rule.distributionConfig) {
      await tx.recurringFundingRule.update({
        where: { id: rule.id },
        data: { distributionConfig: rewritten },
      })
    }
  }

  await tx.envelope.delete({ where: { id: fromEnvelopeId } })
}
