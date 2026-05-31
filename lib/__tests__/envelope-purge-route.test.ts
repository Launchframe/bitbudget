// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findMany: vi.fn() },
    cronRun: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock("@/lib/alert", () => ({ sendAlert: vi.fn() }))

import { prisma } from "@/lib/db"
import { GET } from "@/app/api/cron/envelope-purge/route"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

describe("GET /api/cron/envelope-purge", () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "test-cron-secret"
    vi.mocked(prisma.cronRun.create).mockResolvedValue({ id: "cron_1" } as never)
    vi.mocked(prisma.cronRun.update).mockResolvedValue({} as never)
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret
  })

  function cronRequest() {
    return new NextRequest("http://localhost/api/cron/envelope-purge", {
      headers: { authorization: "Bearer test-cron-secret" },
    })
  }

  it("hard-deletes stale soft-deleted envelopes and detaches non-cascading references", async () => {
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      { id: "env_old", userId: "user_1" },
    ] as never)
    const tx = {
      pendingTransaction: { updateMany: vi.fn() },
      transactionShortcut: { deleteMany: vi.fn() },
      envelope: { delete: vi.fn() },
    }
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (txArg: typeof tx) => Promise<void>) => {
      await fn(tx)
    }) as never)

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    expect(prisma.envelope.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { lt: expect.any(Date) },
        systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS },
      },
      select: { id: true, userId: true },
    })
    expect(tx.pendingTransaction.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", suggestedEnvelopeId: "env_old" },
      data: { suggestedEnvelopeId: null },
    })
    expect(tx.transactionShortcut.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_1", envelopeId: "env_old" },
    })
    expect(tx.envelope.delete).toHaveBeenCalledWith({ where: { id: "env_old" } })
    await expect(response.json()).resolves.toMatchObject({ ok: true, purged: 1 })
  })
})
