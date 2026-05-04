import type { Prisma } from "@prisma/client"

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

  await tx.envelope.delete({ where: { id: fromEnvelopeId } })
}
