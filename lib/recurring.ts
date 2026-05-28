import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"

const MAX_RECURRING_CATCHUP_PER_RULE = 52

/** Thrown inside `$transaction` when another worker advanced `nextDueDate` first (rolls back the insert). */
export class RecurringConcurrentUpdateError extends Error {
  constructor() {
    super("RECURRING_CONCURRENT_UPDATE")
    this.name = "RecurringConcurrentUpdateError"
  }
}

export function advanceDate(date: Date, cadence: Cadence): Date {
  const next = new Date(date)
  switch (cadence) {
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7)
      break
    case "biweekly":
      next.setUTCDate(next.getUTCDate() + 14)
      break
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1)
      break
    case "quarterly":
      next.setUTCMonth(next.getUTCMonth() + 3)
      break
    case "annual":
      next.setUTCFullYear(next.getUTCFullYear() + 1)
      break
  }
  return next
}

type DueRecurringRow = {
  id: string
  userId: string
  envelopeId: string
  payee: string
  amount: number
  type: string
  tags: string
  notes: string | null
  cadence: string
  nextDueDate: Date
  endDate: Date | null
}

/**
 * Post one due occurrence and advance `nextDueDate` atomically.
 * Uses optimistic locking on `nextDueDate` so concurrent cron + refresh cannot double-post.
 * Returns 1 when a transaction was created, 0 when nothing due, -1 when a peer won the race (retry).
 */
async function postOneDueOccurrence(
  recurringId: string,
  endOfDay: Date,
): Promise<number> {
  try {
    // Preview read outside the transaction so getBtcPriceForDate (which may
    // make an outbound HTTP call) does not hold a DB connection open.
    const preview = await prisma.recurringTransaction.findFirst({
      where: { id: recurringId, active: true, nextDueDate: { lte: endOfDay } },
      select: { nextDueDate: true },
    })
    if (!preview) return 0
    const previewDateStr = preview.nextDueDate.toISOString().split("T")[0]
    const btcPrice = await getBtcPriceForDate(previewDateStr)

    return await prisma.$transaction(async (tx) => {
      const rec = await tx.recurringTransaction.findFirst({
        where: {
          id: recurringId,
          active: true,
          nextDueDate: { lte: endOfDay },
        },
      })
      if (!rec) return 0

      const dueDate = rec.nextDueDate

      await tx.transaction.create({
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

      const nextDue = advanceDate(dueDate, rec.cadence as Cadence)

      if (rec.endDate && nextDue > rec.endDate) {
        const updated = await tx.recurringTransaction.updateMany({
          where: { id: rec.id, nextDueDate: dueDate },
          data: { active: false, nextDueDate: nextDue },
        })
        if (updated.count === 0) throw new RecurringConcurrentUpdateError()
        return 1
      }

      const updated = await tx.recurringTransaction.updateMany({
        where: { id: rec.id, nextDueDate: dueDate },
        data: { nextDueDate: nextDue },
      })
      if (updated.count === 0) throw new RecurringConcurrentUpdateError()
      return 1
    })
  } catch (e) {
    if (e instanceof RecurringConcurrentUpdateError) return -1
    throw e
  }
}

async function processOneRecurringRule(rec: DueRecurringRow, endOfDay: Date): Promise<number> {
  let created = 0
  for (let attempt = 0; attempt < MAX_RECURRING_CATCHUP_PER_RULE; attempt++) {
    let result = await postOneDueOccurrence(rec.id, endOfDay)
    if (result === -1) {
      result = await postOneDueOccurrence(rec.id, endOfDay)
    }
    if (result <= 0) break
    created += result
  }
  return created
}

/**
 * Process all due recurring transactions for a user.
 * Creates Transaction records for each occurrence that is due (nextDueDate <= end of asOf-day).
 * Advances nextDueDate and deactivates if past endDate.
 * Returns the number of transactions created.
 *
 * @param asOf - End of this UTC calendar day is the cutoff for "due". Defaults to now. Used by tests for determinism.
 */
export async function processRecurringTransactions(userId: string, asOf?: Date): Promise<number> {
  const endOfDay = new Date(asOf ?? new Date())
  endOfDay.setUTCHours(23, 59, 59, 999)

  const dueRecurrings = await prisma.recurringTransaction.findMany({
    where: {
      userId,
      active: true,
      nextDueDate: { lte: endOfDay },
    },
  })

  let created = 0
  for (const rec of dueRecurrings) {
    created += await processOneRecurringRule(rec, endOfDay)
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

export type PostRecurringEarlyInput = {
  userId: string
  recurringId: string
  envelopeId: string
  txnDate: Date
  payee: string
  amount: number
  type: string
  tags: string
  notes: string | null
  satsAmount: number | null
}

type CreatedRecurringTxn = {
  id: string
  date: Date
  payee: string
  amount: number
  type: string
  envelopeId: string
  tags: string
  notes: string | null
  satsAmount: number | null
  recurringId: string | null
}

export type PostRecurringEarlyResult =
  | { ok: true; transaction: CreatedRecurringTxn; nextDueDate: Date }
  | { ok: false; reason: "not_found" | "concurrent" }

/**
 * Manual early post of a recurring rule (post-now). Atomically creates the transaction
 * and advances nextDueDate from the value read inside the transaction. Optimistic lock
 * on nextDueDate prevents duplicate posts when cron or refresh runs process in parallel.
 */
export async function postRecurringOccurrenceEarly(
  input: PostRecurringEarlyInput,
): Promise<PostRecurringEarlyResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const rec = await tx.recurringTransaction.findFirst({
        where: { id: input.recurringId, userId: input.userId, active: true },
      })
      if (!rec) return { ok: false as const, reason: "not_found" as const }

      const nextDue = advanceDate(rec.nextDueDate, rec.cadence as Cadence)

      const transaction = await tx.transaction.create({
        data: {
          userId: input.userId,
          envelopeId: input.envelopeId,
          date: input.txnDate,
          payee: input.payee,
          amount: input.amount,
          type: input.type,
          tags: input.tags,
          notes: input.notes,
          recurringId: input.recurringId,
          satsAmount: input.satsAmount,
          source: "manual",
        },
      })

      const updated = await tx.recurringTransaction.updateMany({
        where: { id: rec.id, nextDueDate: rec.nextDueDate },
        data: {
          nextDueDate: nextDue,
          ...(rec.endDate && nextDue > rec.endDate ? { active: false } : {}),
        },
      })
      if (updated.count === 0) throw new RecurringConcurrentUpdateError()

      return {
        ok: true as const,
        transaction,
        nextDueDate: nextDue,
      }
    })
  } catch (e) {
    if (e instanceof RecurringConcurrentUpdateError) {
      return { ok: false, reason: "concurrent" }
    }
    throw e
  }
}
