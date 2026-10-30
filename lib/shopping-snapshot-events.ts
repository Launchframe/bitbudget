import type { ShoppingSnapshotEvent, ShoppingSnapshotEventsMeta } from "@/lib/shopping-view"

export type { ShoppingSnapshotEventsMeta }

export type FetchShoppingEventsBeforePage = (beforeSequence: number) => Promise<{
  events: ShoppingSnapshotEvent[]
  hasMore: boolean
}>

/** The events API did not return a page the client can append safely. */
export class ShoppingSnapshotHistoryError extends Error {
  constructor() {
    super("Could not load earlier tab history")
    this.name = "ShoppingSnapshotHistoryError"
  }
}

/** A newer group load replaced this one. Callers should ignore it. */
export class ShoppingSnapshotSupersededError extends Error {
  constructor() {
    super("Superseded")
    this.name = "ShoppingSnapshotSupersededError"
  }
}

function requireSequence(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new ShoppingSnapshotHistoryError()
  return value
}

function minimumSequence(events: readonly ShoppingSnapshotEvent[]): number | null {
  let oldest: number | null = null
  for (const event of events) {
    const sequence = requireSequence(event.sequence)
    if (oldest == null || sequence < oldest) oldest = sequence
  }
  return oldest
}

function readPage(page: { events?: ShoppingSnapshotEvent[]; hasMore?: unknown }): {
  events: ShoppingSnapshotEvent[]
  hasMore: boolean
} {
  if (!page || !Array.isArray(page.events) || typeof page.hasMore !== "boolean") {
    throw new ShoppingSnapshotHistoryError()
  }
  return { events: page.events, hasMore: page.hasMore }
}

/**
 * Snapshot responses include only the newest event window. Walk backward with
 * `GET …/events?beforeSequence=` until `hasMore` is false.
 * The next cursor is the oldest sequence on the page, and it must move strictly
 * backward. A stuck cursor or an empty page that still reports `hasMore` fails
 * closed instead of looping or returning a short ledger.
 */
export async function loadCompleteShoppingSnapshotEvents(
  initialEvents: ShoppingSnapshotEvent[],
  eventsMeta: ShoppingSnapshotEventsMeta | undefined,
  fetchBefore: FetchShoppingEventsBeforePage,
): Promise<ShoppingSnapshotEvent[]> {
  if (!Array.isArray(initialEvents)) throw new ShoppingSnapshotHistoryError()
  const bySequence = new Map<number, ShoppingSnapshotEvent>()
  const add = (rows: readonly ShoppingSnapshotEvent[]) => {
    for (const row of rows) {
      const sequence = requireSequence(row.sequence)
      if (!bySequence.has(sequence)) bySequence.set(sequence, row)
    }
  }

  add(initialEvents)

  let cursor =
    eventsMeta?.oldestIncludedSequence != null
      ? requireSequence(eventsMeta.oldestIncludedSequence)
      : minimumSequence(initialEvents)
  let more = eventsMeta?.hasEarlierEvents === true
  if (more && cursor == null) throw new ShoppingSnapshotHistoryError()

  while (more && cursor != null) {
    const page = readPage(await fetchBefore(cursor))
    if (page.events.length === 0) {
      if (page.hasMore) throw new ShoppingSnapshotHistoryError()
      break
    }
    let oldest = requireSequence(page.events[0]!.sequence)
    if (oldest >= cursor) throw new ShoppingSnapshotHistoryError()
    for (const event of page.events.slice(1)) {
      const sequence = requireSequence(event.sequence)
      if (sequence >= cursor) throw new ShoppingSnapshotHistoryError()
      if (sequence < oldest) oldest = sequence
    }
    add(page.events)
    more = page.hasMore
    cursor = oldest
  }

  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence)
}
