// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const listGroupsForUser = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/shopping-server", () => ({
  listGroupsForUser: (...args: unknown[]) => listGroupsForUser(...args),
  shoppingErrorToResponse: (err: unknown) => {
    throw err
  },
}))

import { GET } from "@/app/api/shopping/groups/route"

describe("GET /api/shopping/groups", () => {
  beforeEach(() => {
    authMock.mockReset()
    listGroupsForUser.mockReset()
  })

  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("lists groups for the session user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } })
    listGroupsForUser.mockResolvedValue([])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(listGroupsForUser).toHaveBeenCalledWith("user-1")
  })
})
