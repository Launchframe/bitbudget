import { NextResponse } from "next/server"
import { unauthorizedCronResponse } from "@/lib/cron-auth"
import { prisma } from "@/lib/db"
import { requirePremiumOrTrial } from "@/lib/subscription"

export async function GET(req: Request) {
  const cronAuth = unauthorizedCronResponse(req)
  if (cronAuth) return cronAuth

  const approvedSenders = await prisma.approvedReceiptSender.findMany()
  if (approvedSenders.length === 0) {
    return NextResponse.json({ scanned: 0, reason: "No approved senders" })
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

  return NextResponse.json({ scanned: accounts.length, processed: 0 })
}
