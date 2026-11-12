import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const batches = await prisma.envelopeFundingBatch.findMany({
    where: { userId: session.user.id, kind: "statement_import" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      _count: { select: { transactions: true } },
    },
  })

  return NextResponse.json(
    batches.map((b) => ({
      id: b.id,
      createdAt: b.createdAt.toISOString(),
      config: b.config,
      transactionCount: b._count.transactions,
    })),
  )
}
