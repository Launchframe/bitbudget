import { NextRequest } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { prisma } from "@/lib/db"
import { envelopeDeletePurgeCutoff } from "@/lib/envelope-delete"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import { runCron } from "@/lib/run-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("envelope-purge", async () => {
    const cutoff = envelopeDeletePurgeCutoff()

    const stale = await prisma.envelope.findMany({
      where: {
        deletedAt: { lt: cutoff },
        systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS },
      },
      select: { id: true, userId: true },
    })

    let purged = 0
    for (const env of stale) {
      await prisma.$transaction(async tx => {
        await tx.pendingTransaction.updateMany({
          where: { userId: env.userId, suggestedEnvelopeId: env.id },
          data: { suggestedEnvelopeId: null },
        })
        await tx.transactionShortcut.deleteMany({
          where: { userId: env.userId, envelopeId: env.id },
        })
        await tx.envelope.delete({ where: { id: env.id } })
      })
      purged += 1
    }

    return { purged, cutoff: cutoff.toISOString() }
  })
}
