/**
 * Staging / local QA helper: subtract days from RecurringTransaction.nextDueDate
 * so the next /api/recurring/process run can create transactions without waiting.
 *
 * Usage:
 *   pnpm qa:recurring:bump -- --userId <cuid> [--recurringId <cuid>] --days 7
 *
 * Requires DATABASE_URL (e.g. from .env). Do not use against production without ops approval.
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

function parseArgs(): { userId: string; recurringId?: string; days: number } {
  const argv = process.argv.slice(2)
  let userId: string | undefined
  let recurringId: string | undefined
  let days: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--userId" && argv[i + 1]) {
      userId = argv[++i]
    } else if (a === "--recurringId" && argv[i + 1]) {
      recurringId = argv[++i]
    } else if (a === "--days" && argv[i + 1]) {
      days = Number(argv[++i])
    }
  }
  if (!userId?.trim()) {
    console.error("Missing required --userId <cuid>")
    process.exit(1)
  }
  if (days == null || !Number.isFinite(days) || days <= 0) {
    console.error("Missing or invalid --days <positive integer>")
    process.exit(1)
  }
  return { userId: userId.trim(), recurringId: recurringId?.trim() || undefined, days: Math.floor(days) }
}

async function main() {
  const { userId, recurringId, days } = parseArgs()
  const ms = days * 86400000

  const where = recurringId
    ? { id: recurringId, userId, active: true }
    : { userId, active: true }

  const rows = await prisma.recurringTransaction.findMany({ where, select: { id: true, nextDueDate: true } })
  if (rows.length === 0) {
    console.log("No matching active recurring rows.")
    return
  }

  for (const row of rows) {
    const next = new Date(row.nextDueDate.getTime() - ms)
    await prisma.recurringTransaction.update({
      where: { id: row.id },
      data: { nextDueDate: next },
    })
    console.log(`Updated ${row.id}: nextDueDate -> ${next.toISOString()}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
