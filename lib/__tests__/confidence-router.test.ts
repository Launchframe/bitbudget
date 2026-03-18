import { describe, expect, it, vi, beforeEach } from "vitest"
import { routeByConfidence } from "@/lib/confidence-router"

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    transaction: { create: vi.fn() },
    pendingTransaction: { create: vi.fn() },
  },
}))

vi.mock("@/lib/server-encrypt", () => ({
  encryptFieldForUser: vi.fn((text: string | null | undefined) =>
    text ? `enc:${text}` : null,
  ),
}))

describe("routeByConfidence", () => {
  it("routes high confidence to live", () => {
    expect(routeByConfidence(0.76)).toBe("live")
    expect(routeByConfidence(1)).toBe("live")
  })
  it("routes low confidence to pending", () => {
    expect(routeByConfidence(0.74)).toBe("pending")
    expect(routeByConfidence(0)).toBe("pending")
  })
})

describe("routeTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("creates live transaction when confidence high and envelope set", async () => {
    const { prisma } = await import("@/lib/db")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      publicKey: "pk",
    } as never)
    vi.mocked(prisma.transaction.create).mockResolvedValue({
      id: "t1",
    } as never)

    const out = await routeTransaction("u1", {
      payee: "Store",
      amount: 10,
      date: new Date("2025-01-01"),
      confidence: 0.9,
      source: "email_forward",
      suggestedEnvelopeId: "env1",
    })

    expect(out.route).toBe("live")
    expect(out.id).toBe("t1")
    expect(prisma.transaction.create).toHaveBeenCalled()
    expect(prisma.pendingTransaction.create).not.toHaveBeenCalled()
  })

  it("creates pending when confidence low", async () => {
    const { prisma } = await import("@/lib/db")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      publicKey: null,
    } as never)
    vi.mocked(prisma.pendingTransaction.create).mockResolvedValue({
      id: "p1",
    } as never)

    const out = await routeTransaction("u1", {
      payee: "Store",
      amount: 10,
      date: new Date("2025-01-01"),
      confidence: 0.4,
      source: "plaid",
      suggestedEnvelopeId: null,
    })

    expect(out.route).toBe("pending")
    expect(prisma.pendingTransaction.create).toHaveBeenCalled()
  })
})
