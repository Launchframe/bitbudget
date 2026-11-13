// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const listShoppingEvents = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/shopping-server", () => ({
  listShoppingEvents: (...args: unknown[]) => listShoppingEvents(...args),
  appendShoppingEvent: vi.fn(),
  shoppingErrorToResponse: (err: unknown) => {
    throw err
  },
}))

import { GET } from "@/app/api/shopping/groups/[groupId]/events/route"

const ctx = { params: Promise.resolve({ groupId: "g1" }) }

function call(query: string) {
  return GET(new Request(`http://localhost/api/shopping/groups/g1/events${query}`), ctx)
}

describe("GET /api/shopping/groups/:groupId/events", () => {
  beforeEach(() => {
    authMock.mockReset()
    listShoppingEvents.mockReset()
    authMock.mockResolvedValue({ user: { id: "user-1" } })
    listShoppingEvents.mockResolvedValue({ events: [], hasMore: false })
  })

  it("rejects both cursors before loading", async () => {
    const res = await call("?afterSequence=1&beforeSequence=2")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Choose either newer or earlier items, not both.",
    })
    expect(listShoppingEvents).not.toHaveBeenCalled()
  })

  it("rejects a cursor that is not a whole number", async () => {
    const res = await call("?beforeSequence=1.5")
    expect(res.status).toBe(400)
    expect(listShoppingEvents).not.toHaveBeenCalled()
  })

  it("asks for the page older than beforeSequence", async () => {
    const res = await call("?beforeSequence=51")
    expect(res.status).toBe(200)
    expect(listShoppingEvents).toHaveBeenCalledWith({
      groupId: "g1",
      userId: "user-1",
      afterSequence: null,
      beforeSequence: 51,
    })
  })

  it("starts at the beginning when no cursor is sent", async () => {
    await call("")
    expect(listShoppingEvents).toHaveBeenCalledWith({
      groupId: "g1",
      userId: "user-1",
      afterSequence: 0,
      beforeSequence: null,
    })
  })
})
