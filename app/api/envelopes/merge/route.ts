import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import { mergeEnvelopeRecords } from "@/lib/server-merge-envelope"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { sourceId, targetId } = await req.json()
  if (!sourceId || !targetId || sourceId === targetId) {
    return NextResponse.json({ error: "Valid source and target envelope IDs are required" }, { status: 400 })
  }

  const userId = session.user.id

  const [source, target] = await Promise.all([
    prisma.envelope.findFirst({ where: { id: sourceId, userId } }),
    prisma.envelope.findFirst({ where: { id: targetId, userId } }),
  ])

  if (!source || !target) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  if (
    source.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS ||
    target.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS
  ) {
    return NextResponse.json(
      { error: "The system Savings envelope cannot be merged." },
      { status: 403 },
    )
  }

  await prisma.$transaction(async (tx) => {
    await mergeEnvelopeRecords(tx, userId, sourceId, targetId)
  })

  const movedCount = await prisma.transaction.count({
    where: { envelopeId: targetId, userId },
  })

  return NextResponse.json({
    success: true,
    targetId,
    transactionsMoved: movedCount,
  })
}
