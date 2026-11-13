import { prisma } from "@/lib/db"
import type { Transaction } from "@/lib/data"
import { shouldCascadeDeleteTransactionBatch } from "@/lib/transaction-batch-delete"
import { suppressShoppingPostingForTransaction } from "@/lib/shopping-posting-server"

/** Delete one transaction; income headers cascade to their full funding batch. */
export async function deleteTransactionForUser(
  userId: string,
  id: string,
): Promise<string[] | null> {
  const txn = await prisma.transaction.findFirst({
    where: { id, userId },
    select: { id: true, type: true, source: true, fundingBatchId: true, shoppingPostingId: true },
  })
  if (!txn) return null

  if (txn.shoppingPostingId) {
    const suppressed = await suppressShoppingPostingForTransaction(userId, id)
    return suppressed ? [id] : null
  }

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
