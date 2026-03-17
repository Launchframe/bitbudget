import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const approvedSenders = await prisma.approvedReceiptSender.findMany()
  if (approvedSenders.length === 0) {
    return NextResponse.json({ scanned: 0, reason: "No approved senders" })
  }

  const accounts = await prisma.connectedEmailAccount.findMany({
    include: { user: { select: { id: true } } },
  })

  for (const account of accounts) {
    await prisma.connectedEmailAccount.update({
      where: { id: account.id },
      data: { lastScanAt: new Date() },
    })
  }

  return NextResponse.json({ scanned: accounts.length, processed: 0 })
}
