// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const findManyMock = vi.fn()
const createMock = vi.fn()
const deleteManyMock = vi.fn()
const updateManyMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    recurringFundingRule: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      deleteMany: (...args: unknown[]) => deleteManyMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}))

import {
  DELETE,
  GET,
  PATCH,
  POST,
} from "@/app/api/recurring-rules/route"

const userId = "user-recurring-rules"

describe("/api/recurring-rules", () => {
  beforeEach(() => {
    authMock.mockReset()
    findManyMock.mockReset()
    createMock.mockReset()
    deleteManyMock.mockReset()
    updateManyMock.mockReset()
    authMock.mockResolvedValue({ user: { id: userId } })
  })

  it("GET returns 401 without session", async () => {
    authMock.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("GET lists rules for the signed-in user", async () => {
    findManyMock.mockResolvedValue([{ id: "r1", kind: "move_funds" }])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rules).toHaveLength(1)
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    )
  })

  it("POST validates kind and frequency", async () => {
    const req = new NextRequest("http://localhost/api/recurring-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "bad",
        frequency: "monthly",
        distributionConfig: {},
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })

  it("POST creates income_distribution rule", async () => {
    createMock.mockResolvedValue({
      id: "rule-1",
      kind: "income_distribution",
      frequency: "monthly",
      nextRunAt: new Date("2026-02-01T12:00:00.000Z"),
    })
    const distributionConfig = {
      distributionBehavior: "set_to_budget",
      fundOverageFromSavings: false,
      grossUsd: 500,
    }
    const req = new NextRequest("http://localhost/api/recurring-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "income_distribution",
        frequency: "monthly",
        distributionConfig,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          kind: "income_distribution",
          frequency: "monthly",
          distributionConfig,
        }),
      }),
    )
  })

  it("DELETE requires id query param", async () => {
    const res = await DELETE(new NextRequest("http://localhost/api/recurring-rules"))
    expect(res.status).toBe(400)
  })

  it("DELETE scopes by user", async () => {
    deleteManyMock.mockResolvedValue({ count: 1 })
    const res = await DELETE(
      new NextRequest("http://localhost/api/recurring-rules?id=rule-abc"),
    )
    expect(res.status).toBe(200)
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: "rule-abc", userId },
    })
  })

  it("PATCH returns 404 when rule not found", async () => {
    updateManyMock.mockResolvedValue({ count: 0 })
    const req = new NextRequest("http://localhost/api/recurring-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "missing", enabled: false }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(404)
  })

  it("PATCH toggles enabled for owned rule", async () => {
    updateManyMock.mockResolvedValue({ count: 1 })
    const req = new NextRequest("http://localhost/api/recurring-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "rule-1", enabled: false }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "rule-1", userId },
      data: { enabled: false },
    })
  })
})
