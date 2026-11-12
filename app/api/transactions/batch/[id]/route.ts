import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

const DELETABLE_KINDS = new Set(["statement_import", "rebalance"])

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  const batch = await prisma.envelopeFundingBatch.findUnique({
    where: { id },
    select: { userId: true, kind: true },
  })

  if (!batch || batch.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (!DELETABLE_KINDS.has(batch.kind)) {
    return NextResponse.json(
      { error: "This batch type cannot be deleted via this route." },
      { status: 400 },
    )
  }

  // Delete all linked transactions, then the batch row
  await prisma.transaction.deleteMany({ where: { fundingBatchId: id, userId: session.user.id } })
  await prisma.envelopeFundingBatch.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
