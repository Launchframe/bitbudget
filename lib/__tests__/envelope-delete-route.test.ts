// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { DELETE } from "@/app/api/envelopes/route"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

describe("DELETE /api/envelopes", () => {
  const userId = "user_1"
  const envelopeId = "env_1"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({
      id: envelopeId,
      userId,
      systemRole: null,
    } as never)
  })

  function deleteRequest(id = envelopeId) {
    return new NextRequest(`http://localhost/api/envelopes?id=${id}`, {
      method: "DELETE",
    })
  }

  it("soft-deletes a user envelope with a server timestamp", async () => {
    const response = await DELETE(deleteRequest())

    expect(response.status).toBe(200)
    expect(prisma.envelope.update).toHaveBeenCalledWith({
      where: { id: envelopeId },
      data: { deletedAt: expect.any(Date) },
    })
    const json = await response.json()
    expect(json).toEqual({
      success: true,
      deletedAt: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(json.deletedAt))).toBe(false)
  })

  it("rejects deleting the system Savings envelope", async () => {
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({
      id: envelopeId,
      userId,
      systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
    } as never)

    const response = await DELETE(deleteRequest())

    expect(response.status).toBe(403)
    expect(prisma.envelope.update).not.toHaveBeenCalled()
  })
})
