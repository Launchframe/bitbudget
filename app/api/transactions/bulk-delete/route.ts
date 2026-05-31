import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/** Cap how many ids one request may delete to bound the query. */
const MAX_BULK_DELETE = 2000

/**
 * Bulk-delete transactions by id (used by the duplicate cleanup tool).
 *
 * Scoped strictly to the caller's own rows. The cleanup UI excludes funding-batch
 * legs, so this performs a plain `deleteMany` on the provided ids without batch
 * cascade — callers that need cascade semantics use single DELETE instead.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { ids?: unknown }
  try {
    body = (await req.json()) as { ids?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const ids = body.ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No transaction ids provided" }, { status: 400 })
  }
  if (!ids.every((id) => typeof id === "string" && id.length > 0)) {
    return NextResponse.json({ error: "All ids must be non-empty strings" }, { status: 400 })
  }
  if (ids.length > MAX_BULK_DELETE) {
    return NextResponse.json(
      { error: `Too many ids; delete at most ${MAX_BULK_DELETE} at a time` },
      { status: 400 },
    )
  }

  const uniqueIds = Array.from(new Set(ids as string[]))

  const { count } = await prisma.transaction.deleteMany({
    where: { userId: session.user.id, id: { in: uniqueIds } },
  })

  return NextResponse.json({ deleted: count, requestedIds: uniqueIds })
}
