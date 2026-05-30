import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  let health: Record<string, unknown> = { ok: false }
  try {
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
    const res = await fetch(`${base}/api/health`, { cache: "no-store" })
    health = (await res.json()) as Record<string, unknown>
    health.httpStatus = res.status
  } catch {
    health = { ok: false, error: "health_fetch_failed" }
  }

  const [recentFailures, cronNames, pendingSenders] = await Promise.all([
    prisma.opsEvent.findMany({
      where: { severity: { in: ["error", "page"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.cronRun.groupBy({
      by: ["name"],
      _max: { startedAt: true },
    }),
    prisma.pendingSenderReview.count({ where: { status: "pending" } }),
  ])

  const latestCronRuns = await Promise.all(
    cronNames.map(async ({ name }) => {
      const run = await prisma.cronRun.findFirst({
        where: { name },
        orderBy: { startedAt: "desc" },
      })
      return run
    }),
  )

  return NextResponse.json({
    health,
    recentFailures,
    latestCronRuns: latestCronRuns.filter(Boolean),
    pendingSenders,
  })
}
