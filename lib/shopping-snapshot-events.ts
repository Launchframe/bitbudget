import type { ShoppingSnapshotEvent, ShoppingSnapshotEventsMeta } from "@/lib/shopping-view"

export type { ShoppingSnapshotEventsMeta }

export type FetchShoppingEventsBeforePage = (beforeSequence: number) => Promise<{
  events: ShoppingSnapshotEvent[]
  hasMore: boolean
}>

/**
 * Snapshot responses include only the newest event window. Walk backward with
 * `GET …/events?beforeSequence=<oldestIncludedSequence>` until `hasMore` is false.
 */
export async function loadCompleteShoppingSnapshotEvents(
  initialEvents: ShoppingSnapshotEvent[],
  eventsMeta: ShoppingSnapshotEventsMeta | undefined,
  fetchBefore: FetchShoppingEventsBeforePage,
): Promise<ShoppingSnapshotEvent[]> {
  let events = [...initialEvents]
  let cursor = eventsMeta?.oldestIncludedSequence ?? events[0]?.sequence ?? null
  let more = eventsMeta?.hasEarlierEvents ?? false

  while (more && cursor != null) {
    const page = await fetchBefore(cursor)
    if (page.events.length === 0) break
    events = [...page.events, ...events]
    more = page.hasMore
    cursor = page.events[0]?.sequence ?? null
  }

  return events
}
