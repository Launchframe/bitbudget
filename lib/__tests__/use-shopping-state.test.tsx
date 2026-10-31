// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShoppingSnapshotSupersededError } from "@/lib/shopping-snapshot-events"
import { useShoppingState } from "@/lib/use-shopping-state"

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({
    currentUserId: "user-1",
    encryption: { ready: true, needsPinUnlock: false },
  }),
}))

vi.mock("@/lib/shopping-cache", () => ({
  saveShoppingSnapshot: vi.fn(async () => {}),
  listShoppingOutbox: vi.fn(async () => []),
  removeShoppingOutboxItem: vi.fn(async () => {}),
  enqueueShoppingOutbox: vi.fn(async () => {}),
}))

interface PendingFetch {
  url: string
  resolve: (res: Response) => void
}

const pending: PendingFetch[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function groupSummary(id: string) {
  return {
    id,
    keyVersion: 1,
    membershipRevision: 1,
    eventSequence: 0,
    lifecycle: "active",
    encryptedMetadata: "sg1:aabbcc",
    updatedAt: "2026-09-01T00:00:00.000Z",
    myMember: {
      id: "m1",
      localId: "local",
      role: "owner",
      status: "active",
      encryptedAlias: "sg1:aabbcc",
      pinnedKeyFingerprint: "abcd-abcd-abcd-abcd",
      historyAccess: true,
    },
    wraps: [],
  }
}

describe("useShoppingState refresh", () => {
  beforeEach(() => {
    pending.length = 0
    vi.useFakeTimers()
    vi.stubGlobal("fetch", (url: string) => {
      return new Promise<Response>((resolve) => {
        pending.push({ url, resolve })
      })
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function groupListRequests(): PendingFetch[] {
    return pending.filter((entry) => entry.url === "/api/shopping/groups")
  }

  async function resolveGroupList(entry: PendingFetch, groups: ReturnType<typeof groupSummary>[]) {
    const index = pending.indexOf(entry)
    if (index >= 0) pending.splice(index, 1)
    await act(async () => {
      entry.resolve(jsonResponse({ groups }))
    })
  }

  it("keeps the newer group list when an older poll finishes last", async () => {
    const { result } = renderHook(() => useShoppingState())
    expect(result.current.loading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    const requests = groupListRequests()
    expect(requests).toHaveLength(2)

    await resolveGroupList(requests[1]!, [groupSummary("newer")])
    expect(result.current.groups.map((group) => group.id)).toEqual(["newer"])
    expect(result.current.loading).toBe(false)

    await resolveGroupList(requests[0]!, [groupSummary("older")])
    expect(result.current.groups.map((group) => group.id)).toEqual(["newer"])
  })

  it("does not mark the list as loading on the background poll", async () => {
    const { result } = renderHook(() => useShoppingState())
    const initial = groupListRequests()
    expect(initial).toHaveLength(1)
    await resolveGroupList(initial[0]!, [groupSummary("g1")])
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(result.current.loading).toBe(false)
    expect(pending.some((entry) => entry.url === "/api/shopping/groups")).toBe(true)
  })

  it("drops a group load that a newer load replaced", async () => {
    const { result } = renderHook(() => useShoppingState())
    const initial = groupListRequests()
    expect(initial).toHaveLength(1)
    await resolveGroupList(initial[0]!, [])

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.fetchGroup("group-a")
      second = result.current.fetchGroup("group-b")
    })
    const firstSettled = expect(first).rejects.toBeInstanceOf(ShoppingSnapshotSupersededError)
    const secondSettled = expect(second).resolves.toMatchObject({ group: { id: "group-b" }, events: [] })

    const groupFetches = pending.filter((entry) => entry.url.startsWith("/api/shopping/groups/group-"))
    expect(groupFetches).toHaveLength(2)
    const snapshot = {
      events: [],
      eventsMeta: { oldestIncludedSequence: null, hasEarlierEvents: false },
      group: { id: "group-b" },
    }
    await act(async () => {
      groupFetches[0]!.resolve(jsonResponse({ ...snapshot, group: { id: "group-a" } }))
      groupFetches[1]!.resolve(jsonResponse(snapshot))
    })

    await firstSettled
    await secondSettled
  })
})
