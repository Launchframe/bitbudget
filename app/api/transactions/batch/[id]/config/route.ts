import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET(
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
    select: { userId: true, kind: true, config: true },
  })

  if (!batch || batch.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({
    kind: batch.kind,
    config: batch.config ?? null,
  })
}
