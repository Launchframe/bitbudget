// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { POST } from "@/app/api/transactions/bulk-delete/route"

const userId = "user_1"

function postRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/transactions/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never
}

const plainRow = (id: string) => ({
  id,
  type: "expense" as const,
  source: "manual",
  fundingBatchId: null,
})

const fundingLegRow = (id: string) => ({
  id,
  type: "expense" as const,
  source: "envelope_funding_out",
  fundingBatchId: "batch_1",
})

const incomeHeaderRow = (id: string) => ({
  id,
  type: "credit" as const,
  source: "income_import",
  fundingBatchId: "batch_1",
})

const sweepRow = (id: string) => ({
  id,
  type: "expense" as const,
  source: "envelope_sweep",
  fundingBatchId: "sweep_1",
})

describe("POST /api/transactions/bulk-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
  })

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await POST(postRequest({ ids: ["tx1"] }))
    expect(res.status).toBe(401)
  })

  it("returns 400 for an empty ids array", async () => {
    const res = await POST(postRequest({ ids: [] }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when ids contains a non-string", async () => {
    const res = await POST(postRequest({ ids: ["tx1", 42] }))
    expect(res.status).toBe(400)
  })

  it("deletes plain eligible rows and returns count", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      plainRow("tx1"),
      plainRow("tx2"),
    ] as never)
    vi.mocked(prisma.transaction.deleteMany).mockResolvedValue({ count: 2 } as never)

    const res = await POST(postRequest({ ids: ["tx1", "tx2"] }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { deleted: number }
    expect(json.deleted).toBe(2)

    expect(vi.mocked(prisma.transaction.deleteMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId }),
      }),
    )
  })

  it("returns 400 and lists rejectedIds when an id is not found for the user", async () => {
    // Only tx1 is returned by findMany (tx2 not owned by user)
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([plainRow("tx1")] as never)

    const res = await POST(postRequest({ ids: ["tx1", "tx2"] }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { rejectedIds: string[] }
    expect(json.rejectedIds).toContain("tx2")
    expect(vi.mocked(prisma.transaction.deleteMany)).not.toHaveBeenCalled()
  })

  it("returns 400 and rejects a funding allocation leg", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([fundingLegRow("tx1")] as never)

    const res = await POST(postRequest({ ids: ["tx1"] }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { rejectedIds: string[] }
    expect(json.rejectedIds).toContain("tx1")
    expect(vi.mocked(prisma.transaction.deleteMany)).not.toHaveBeenCalled()
  })

  it("returns 400 and rejects an income header row (needs cascade)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([incomeHeaderRow("tx1")] as never)

    const res = await POST(postRequest({ ids: ["tx1"] }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { rejectedIds: string[] }
    expect(json.rejectedIds).toContain("tx1")
    expect(vi.mocked(prisma.transaction.deleteMany)).not.toHaveBeenCalled()
  })

  it("returns 400 and rejects a sweep row (needs cascade)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([sweepRow("tx1")] as never)

    const res = await POST(postRequest({ ids: ["tx1"] }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { rejectedIds: string[] }
    expect(json.rejectedIds).toContain("tx1")
    expect(vi.mocked(prisma.transaction.deleteMany)).not.toHaveBeenCalled()
  })

  it("rejects the entire batch if even one id is ineligible (atomic rejection)", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      plainRow("tx1"),
      fundingLegRow("tx2"),
    ] as never)

    const res = await POST(postRequest({ ids: ["tx1", "tx2"] }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { rejectedIds: string[] }
    expect(json.rejectedIds).toContain("tx2")
    // tx1 is safe but should NOT be deleted — atomic rejection protects the batch
    expect(vi.mocked(prisma.transaction.deleteMany)).not.toHaveBeenCalled()
  })

  it("deduplicates ids before validation and deletion", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([plainRow("tx1")] as never)
    vi.mocked(prisma.transaction.deleteMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST(postRequest({ ids: ["tx1", "tx1", "tx1"] }))
    expect(res.status).toBe(200)

    const findCall = vi.mocked(prisma.transaction.findMany).mock.calls[0]?.[0] as {
      where: { id: { in: string[] } }
    }
    expect(findCall.where.id.in).toHaveLength(1)
  })
})
