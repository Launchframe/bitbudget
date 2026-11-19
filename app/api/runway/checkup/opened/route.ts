import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { validateMonthKey } from "@/lib/runway-journal"

/**
 * Mark a month's Runway checkup as opened. The dashboard "<Month> checkup is
 * ready" prompt stays until `RunwayPlan.checkupOpenedMonthKey` matches the
 * month the user opened. We get-or-create the plan the same way the plan GET
 * does (unique userId, so concurrent first-time writes race on P2002).
 *
 * NOTE (A3 convergence): this reuses `RunwayPlan.checkupOpenedMonthKey` from the
 * A3 schema this branch is based on. If A3's full plan model lands separately,
 * this field remains the single source of truth for "checkup opened" — no new
 * duplicate column is introduced here.
 *
 * The response is private and uncached, same as the plan session API.
 */
export const dynamic = "force-dynamic"

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" }

function checkupResponse(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: PRIVATE_NO_STORE,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return checkupResponse({ error: "Please sign in." }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return checkupResponse(
      { error: "We couldn't read that request." },
      { status: 400 },
    )
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return checkupResponse(
      { error: "Expected a month to mark as opened." },
      { status: 400 },
    )
  }

  const monthKey = validateMonthKey((raw as { monthKey?: unknown }).monthKey)
  if (!monthKey.ok) {
    return checkupResponse({ error: monthKey.error }, { status: 400 })
  }

  // Get-or-create the plan, then set the opened month. upsert keyed on the
  // unique userId handles the "no plan yet" case atomically.
  try {
    const saved = await prisma.runwayPlan.upsert({
      where: { userId },
      create: { userId, checkupOpenedMonthKey: monthKey.value },
      update: { checkupOpenedMonthKey: monthKey.value },
      select: { checkupOpenedMonthKey: true },
    })
    return checkupResponse({
      checkupOpenedMonthKey: saved.checkupOpenedMonthKey,
    })
  } catch (err) {
    // A concurrent first-time create can still surface P2002; retry the update
    // path since the row now exists.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const saved = await prisma.runwayPlan.update({
        where: { userId },
        data: { checkupOpenedMonthKey: monthKey.value },
        select: { checkupOpenedMonthKey: true },
      })
      return checkupResponse({
        checkupOpenedMonthKey: saved.checkupOpenedMonthKey,
      })
    }
    throw err
  }
}
