import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const name = req.nextUrl.searchParams.get("name")?.trim()
  const take = Math.min(parseInt(req.nextUrl.searchParams.get("take") ?? "20", 10) || 20, 100)

  const runs = await prisma.cronRun.findMany({
    where: name ? { name } : undefined,
    orderBy: { startedAt: "desc" },
    take,
  })

  return NextResponse.json(runs)
}
