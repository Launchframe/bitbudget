import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"

export function advanceDate(date: Date, cadence: Cadence): Date {
  const next = new Date(date)
  switch (cadence) {
    case "weekly":
      next.setDate(next.getDate() + 7)
      break
    case "biweekly":
      next.setDate(next.getDate() + 14)
      break
    case "monthly":
      next.setMonth(next.getMonth() + 1)
      break
    case "quarterly":
      next.setMonth(next.getMonth() + 3)
      break
    case "annual":
      next.setFullYear(next.getFullYear() + 1)
      break
  }
  return next
}

/**
 * Process all due recurring transactions for a user.
 * Creates Transaction records for each occurrence that is due (nextDueDate <= today).
 * Advances nextDueDate and deactivates if past endDate.
 * Returns the number of transactions created.
 */
export async function processRecurringTransactions(userId: string): Promise<number> {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const dueRecurrings = await prisma.recurringTransaction.findMany({
    where: {
      userId,
      active: true,
      nextDueDate: { lte: today },
    },
  })

  let created = 0

  for (const rec of dueRecurrings) {
    let dueDate = new Date(rec.nextDueDate)

    while (dueDate <= today) {
      const dateStr = dueDate.toISOString().split("T")[0]
      const btcPrice = await getBtcPriceForDate(dateStr)

      await prisma.transaction.create({
        data: {
          userId: rec.userId,
          envelopeId: rec.envelopeId,
          date: dueDate,
          payee: rec.payee,
          amount: rec.amount,
          type: rec.type,
          tags: rec.tags,
          notes: rec.notes,
          recurringId: rec.id,
          satsAmount: btcPrice ? usdToSats(rec.amount, btcPrice) : null,
        },
      })
      created++

      dueDate = advanceDate(dueDate, rec.cadence as Cadence)

      if (rec.endDate && dueDate > rec.endDate) {
        await prisma.recurringTransaction.update({
          where: { id: rec.id },
          data: { active: false, nextDueDate: dueDate },
        })
        break
      }
    }

    if (!rec.endDate || dueDate <= rec.endDate) {
      await prisma.recurringTransaction.update({
        where: { id: rec.id },
        data: { nextDueDate: dueDate },
      })
    }
  }

  return created
}

/**
 * Process recurring transactions for ALL active users.
 * Intended for cron job context where there is no user session.
 */
export async function processAllRecurringTransactions(): Promise<number> {
  const users = await prisma.recurringTransaction.findMany({
    where: { active: true },
    select: { userId: true },
    distinct: ["userId"],
  })

  let total = 0
  for (const { userId } of users) {
    total += await processRecurringTransactions(userId)
  }
  return total
}
