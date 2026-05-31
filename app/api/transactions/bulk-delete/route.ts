import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type { Transaction } from "@/lib/data"
import {
  canDeleteTransactionFromList,
  shouldCascadeDeleteTransactionBatch,
} from "@/lib/transaction-batch-delete"

type BulkDeleteEligibilityRow = Pick<Transaction, "type" | "source" | "fundingBatchId">

/** Cap how many ids one request may delete to bound the query. */
const MAX_BULK_DELETE = 2000

/**
 * Bulk-delete transactions by id (used by the duplicate cleanup tool).
 *
 * Scoped strictly to the caller's own rows. Before deleting, the route pre-fetches
 * every requested row and rejects any that are:
 *  - not found (or belong to a different user)
 *  - funding allocation legs (must be managed via their income header)
 *  - income headers or sweep rows that require cascade semantics
 *
 * The duplicate cleanup UI already excludes these rows, so a rejection here
 * signals an unexpected or adversarial caller.
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

  // Pre-fetch all rows owned by this user so we can validate eligibility before
  // touching the database. A single findMany is cheaper than N individual fetches.
  const rows = await prisma.transaction.findMany({
    where: { id: { in: uniqueIds }, userId: session.user.id },
    select: { id: true, type: true, source: true, fundingBatchId: true },
  })
  const foundIds = new Set(rows.map((r) => r.id))

  const rejectedIds: string[] = []
  for (const id of uniqueIds) {
    if (!foundIds.has(id)) {
      // Missing or belongs to a different user — treat as ineligible.
      rejectedIds.push(id)
      continue
    }
    const row = rows.find((r) => r.id === id)! as BulkDeleteEligibilityRow
    // #region agent log
    fetch("http://127.0.0.1:7592/ingest/258423e2-0af9-4cd3-ab6c-55bd906b1f21", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ae824c" },
      body: JSON.stringify({
        sessionId: "ae824c",
        runId: "post-fix",
        hypothesisId: "H1",
        location: "bulk-delete/route.ts:eligibility",
        message: "bulk-delete eligibility check",
        data: {
          id,
          source: row.source,
          canDelete: canDeleteTransactionFromList(row),
          needsCascade: shouldCascadeDeleteTransactionBatch(row),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    if (!canDeleteTransactionFromList(row) || shouldCascadeDeleteTransactionBatch(row)) {
      // Funding leg, income header, or sweep row — must not be standalone-deleted.
      rejectedIds.push(id)
    }
  }

  if (rejectedIds.length > 0) {
    return NextResponse.json(
      {
        error:
          "Some ids cannot be bulk-deleted (not found, not owned, or part of a managed funding/sweep batch)",
        rejectedIds,
      },
      { status: 400 },
    )
  }

  const { count } = await prisma.transaction.deleteMany({
    where: { userId: session.user.id, id: { in: uniqueIds } },
  })

  return NextResponse.json({ deleted: count, requestedIds: uniqueIds })
}
