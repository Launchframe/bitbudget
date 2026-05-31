// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { PUT } from "@/app/api/envelopes/route"

describe("PUT /api/envelopes monthlyAllotment validation", () => {
  const userId = "user_1"
  const envelopeId = "env_1"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({
      id: envelopeId,
      userId,
      systemRole: null,
      monthlyAllotment: 100,
      name: "Groceries",
      color: "#10B981",
      icon: null,
      archived: false,
      sweepPolicy: "reset",
      sweepCapMultiplier: null,
    } as never)
    vi.mocked(prisma.envelope.update).mockResolvedValue({
      id: envelopeId,
      userId,
      systemRole: null,
      monthlyAllotment: 50,
      name: "Groceries",
      color: "#10B981",
      icon: null,
      archived: false,
      sweepPolicy: "reset",
      sweepCapMultiplier: null,
      createdAt: new Date("2026-05-31T00:00:00Z"),
    } as never)
  })

  function putRequest(body: Record<string, unknown>) {
    return new Request("http://localhost/api/envelopes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: envelopeId, ...body }),
    })
  }

  it("rejects negative monthlyAllotment", async () => {
    const response = await PUT(putRequest({ monthlyAllotment: -1 }) as never)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "monthlyAllotment must be a non-negative number",
    })
    expect(prisma.envelope.update).not.toHaveBeenCalled()
  })

  it("rejects non-number monthlyAllotment", async () => {
    const response = await PUT(putRequest({ monthlyAllotment: "not-a-number" }) as never)
    expect(response.status).toBe(400)
    expect(prisma.envelope.update).not.toHaveBeenCalled()
  })

  it("ignores null monthlyAllotment (omit field, do not clear allotment)", async () => {
    const response = await PUT(putRequest({ monthlyAllotment: null }) as never)
    expect(response.status).toBe(200)
    const updateArg = vi.mocked(prisma.envelope.update).mock.calls[0]?.[0] as {
      data: { monthlyAllotment?: number }
    }
    expect(updateArg.data.monthlyAllotment).toBeUndefined()
  })

  it("accepts valid monthlyAllotment and rounds to two decimals", async () => {
    const response = await PUT(putRequest({ monthlyAllotment: 99.999 }) as never)
    expect(response.status).toBe(200)
    expect(prisma.envelope.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ monthlyAllotment: 100 }),
      }),
    )
  })
})
