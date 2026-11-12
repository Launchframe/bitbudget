import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const severity = req.nextUrl.searchParams.get("severity")?.trim()
  const take = Math.min(parseInt(req.nextUrl.searchParams.get("take") ?? "50", 10) || 50, 100)

  const events = await prisma.opsEvent.findMany({
    where: severity ? { severity } : undefined,
    orderBy: { createdAt: "desc" },
    take,
  })

  return NextResponse.json(events)
}
