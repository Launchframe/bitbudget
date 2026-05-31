type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function bulkDeleteErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error
    }
  } catch {
    /* ignore malformed error body */
  }
  return "Bulk delete failed"
}

/** POST transaction ids to the bulk-delete endpoint and surface API failures. */
export async function requestBulkDeleteTransactions(
  ids: readonly string[],
  fetcher: FetchLike = fetch,
): Promise<number> {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return 0

  const res = await fetcher("/api/transactions/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: uniqueIds }),
  })

  if (!res.ok) {
    throw new Error(await bulkDeleteErrorMessage(res))
  }

  const body = (await res.json().catch(() => ({}))) as { deleted?: unknown }
  const n = body.deleted
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}
