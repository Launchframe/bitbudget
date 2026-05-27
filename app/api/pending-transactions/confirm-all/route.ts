import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { confirmPendingTransactionAtomic } from "@/lib/pending-transaction-confirm"
import { recordPayeeMapping } from "@/lib/envelope-matcher"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let payeePlainById: Record<string, string> = {}
  try {
    const body = await req.json()
    if (body?.payeePlainById && typeof body.payeePlainById === "object") {
      payeePlainById = body.payeePlainById as Record<string, string>
    }
  } catch {
    /* empty body */
  }

  const pendingList = await prisma.pendingTransaction.findMany({
    where: {
      userId: session.user.id,
      suggestedEnvelopeId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  })

  let confirmed = 0
  for (const pending of pendingList) {
    const envelopeId = pending.suggestedEnvelopeId!
    const envelope = await prisma.envelope.findFirst({
      where: { id: envelopeId, userId: session.user.id },
    })
    if (!envelope) continue

    const transaction = await confirmPendingTransactionAtomic(
      session.user.id,
      pending.id,
      envelopeId,
    )
    if (!transaction) continue

    const plain = payeePlainById[pending.id]?.trim()
    if (plain) {
      await recordPayeeMapping(session.user.id, plain, envelopeId)
    }
    confirmed++
  }

  return NextResponse.json({ confirmed })
}
