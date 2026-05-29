// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findFirst: vi.fn() },
    transaction: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/server-merge-envelope", () => ({ mergeEnvelopeRecords: vi.fn() }))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { mergeEnvelopeRecords } from "@/lib/server-merge-envelope"
import { POST } from "@/app/api/envelopes/merge/route"

describe("POST /api/envelopes/merge", () => {
  const userId = "user_1"
  const sourceId = "env_source"
  const targetId = "env_target"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.envelope.findFirst).mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === sourceId) {
        return Promise.resolve({
          id: sourceId,
          userId,
          archived: false,
          systemRole: null,
        } as never)
      }
      if (where.id === targetId) {
        return Promise.resolve({
          id: targetId,
          userId,
          archived: false,
          systemRole: null,
        } as never)
      }
      return Promise.resolve(null)
    })
  })

  function mergeRequest() {
    return new Request("http://localhost/api/envelopes/merge", {
      method: "POST",
      body: JSON.stringify({ sourceId, targetId }),
    })
  }

  it("rejects merging from an archived envelope", async () => {
    vi.mocked(prisma.envelope.findFirst).mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === sourceId) {
        return Promise.resolve({
          id: sourceId,
          userId,
          archived: true,
          systemRole: null,
        } as never)
      }
      return Promise.resolve({
        id: targetId,
        userId,
        archived: false,
        systemRole: null,
      } as never)
    })

    const response = await POST(mergeRequest() as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Archived envelopes cannot be merged.",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mergeEnvelopeRecords).not.toHaveBeenCalled()
  })

  it("rejects merging into an archived envelope", async () => {
    vi.mocked(prisma.envelope.findFirst).mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === sourceId) {
        return Promise.resolve({
          id: sourceId,
          userId,
          archived: false,
          systemRole: null,
        } as never)
      }
      return Promise.resolve({
        id: targetId,
        userId,
        archived: true,
        systemRole: null,
      } as never)
    })

    const response = await POST(mergeRequest() as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Archived envelopes cannot be merged.",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mergeEnvelopeRecords).not.toHaveBeenCalled()
  })
})
