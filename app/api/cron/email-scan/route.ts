import { NextRequest } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { prisma } from "@/lib/db"
import { requirePremiumOrTrial } from "@/lib/subscription"
import { runCron } from "@/lib/run-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("email-scan", async () => {
    const approvedSenders = await prisma.approvedReceiptSender.findMany()
    if (approvedSenders.length === 0) {
      return { scanned: 0, reason: "No approved senders", processed: 0 }
    }

    const accounts = await prisma.connectedEmailAccount.findMany({
      include: { user: { select: { id: true } } },
    })

    for (const account of accounts) {
      if (!(await requirePremiumOrTrial(account.user.id))) continue
      await prisma.connectedEmailAccount.update({
        where: { id: account.id },
        data: { lastScanAt: new Date() },
      })
    }

    return { scanned: accounts.length, processed: 0 }
  })
}
