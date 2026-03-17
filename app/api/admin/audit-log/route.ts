import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action")?.trim() || undefined

  const logs = await prisma.auditLog.findMany({
    where: action ? { action } : undefined,
    include: { admin: { select: { email: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return NextResponse.json(logs)
}
