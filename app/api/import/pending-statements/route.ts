import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/** Lists pending statement batches awaiting review (e.g. from email forwarding). */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const batches = await prisma.pendingStatementBatch.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      source: true,
      institutionName: true,
      format: true,
      dateFrom: true,
      dateTo: true,
      transactionCount: true,
      createdAt: true,
    },
  })

  return NextResponse.json(
    batches.map((b) => ({
      id: b.id,
      source: b.source,
      institutionName: b.institutionName,
      format: b.format,
      dateFrom: b.dateFrom,
      dateTo: b.dateTo,
      transactionCount: b.transactionCount,
      createdAt: b.createdAt.toISOString(),
    })),
  )
}
