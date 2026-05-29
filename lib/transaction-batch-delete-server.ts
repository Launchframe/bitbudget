import { prisma } from "@/lib/db"
import type { Transaction } from "@/lib/data"
import { shouldCascadeDeleteTransactionBatch } from "@/lib/transaction-batch-delete"

/** Delete one transaction; income headers cascade to their full funding batch. */
export async function deleteTransactionForUser(
  userId: string,
  id: string,
): Promise<string[] | null> {
  const txn = await prisma.transaction.findFirst({
    where: { id, userId },
    select: { id: true, type: true, source: true, fundingBatchId: true },
  })
  if (!txn) return null

  let idsToDelete = [txn.id]
  if (
    shouldCascadeDeleteTransactionBatch(
      txn as Pick<Transaction, "type" | "source" | "fundingBatchId">,
    ) &&
    txn.fundingBatchId
  ) {
    const batchRows = await prisma.transaction.findMany({
      where: { userId, fundingBatchId: txn.fundingBatchId },
      select: { id: true },
    })
    idsToDelete = batchRows.map((r) => r.id)
  }

  await prisma.transaction.deleteMany({
    where: { userId, id: { in: idsToDelete } },
  })

  return idsToDelete
}
