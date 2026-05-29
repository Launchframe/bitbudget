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

  it("rejects NaN and Infinity monthlyAllotment", async () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const response = await PUT(putRequest({ monthlyAllotment: bad }) as never)
      expect(response.status).toBe(400)
      expect(prisma.envelope.update).not.toHaveBeenCalled()
    }
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
