import { prisma } from "@/lib/db"
import type { PlaidAccountSnapshot } from "@/lib/plaid-ledger"

function balanceData(snapshot: PlaidAccountSnapshot) {
  return {
    plaidAccountId: snapshot.accountId,
    accountName: snapshot.name,
    mask: snapshot.mask,
    type: snapshot.type,
    currentBalance: snapshot.balances.current,
    availableBalance: snapshot.balances.available,
    isoCurrencyCode: snapshot.balances.isoCurrencyCode,
    balanceUpdatedAt: new Date(),
  }
}

/**
 * Insert or refresh linked accounts for one Plaid item, then drop rows Plaid
 * no longer returned. A closed account must not keep inflating the cash total.
 * Call this only with the full account list from a successful accounts fetch.
 */
export async function upsertPlaidAccountSnapshots(
  plaidItemDbId: string,
  snapshots: readonly PlaidAccountSnapshot[],
): Promise<void> {
  const seen: string[] = []
  for (const snapshot of snapshots) {
    const data = balanceData(snapshot)
    seen.push(snapshot.accountId)
    const existing = await prisma.plaidAccount.findFirst({
      where: { plaidItemId: plaidItemDbId, plaidAccountId: snapshot.accountId },
      select: { id: true },
    })
    if (existing) {
      await prisma.plaidAccount.update({ where: { id: existing.id }, data })
      continue
    }

    const legacy = await prisma.plaidAccount.findFirst({
      where: {
        plaidItemId: plaidItemDbId,
        plaidAccountId: null,
        accountName: snapshot.name,
        mask: snapshot.mask,
      },
      select: { id: true },
    })
    if (legacy) {
      await prisma.plaidAccount.update({ where: { id: legacy.id }, data })
      continue
    }

    await prisma.plaidAccount.create({
      data: { plaidItemId: plaidItemDbId, ...data },
    })
  }

  await prisma.plaidAccount.deleteMany({
    where:
      seen.length === 0
        ? { plaidItemId: plaidItemDbId }
        : {
            plaidItemId: plaidItemDbId,
            OR: [{ plaidAccountId: null }, { plaidAccountId: { notIn: seen } }],
          },
  })
}
