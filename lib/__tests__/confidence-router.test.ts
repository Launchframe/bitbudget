import { describe, expect, it, vi, beforeEach } from "vitest"
import { routeByConfidence } from "@/lib/confidence-router"

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    envelope: { findFirst: vi.fn() },
    transaction: { create: vi.fn() },
    pendingTransaction: { create: vi.fn() },
  },
}))

vi.mock("@/lib/server-encrypt", () => ({
  encryptFieldForUser: vi.fn(
    (text: string | null | undefined, publicKeyHex: string | null | undefined) =>
      text && publicKeyHex ? `enc:${text}` : null,
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
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({
      id: "env1",
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

  it("routes to pending when high confidence but no envelope", async () => {
    const { prisma } = await import("@/lib/db")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      publicKey: "pk",
    } as never)
    vi.mocked(prisma.pendingTransaction.create).mockResolvedValue({
      id: "p2",
    } as never)

    const out = await routeTransaction("u1", {
      payee: "Store",
      amount: 20,
      date: new Date("2025-01-01"),
      confidence: 0.9,
      source: "plaid",
      suggestedEnvelopeId: null,
    })

    expect(out.route).toBe("pending")
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(prisma.pendingTransaction.create).toHaveBeenCalled()
  })

  it("routes to pending when suggested envelope does not belong to user", async () => {
    const { prisma } = await import("@/lib/db")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      publicKey: "pk",
    } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.pendingTransaction.create).mockResolvedValue({
      id: "p-env",
    } as never)

    const out = await routeTransaction("u1", {
      payee: "Store",
      amount: 10,
      date: new Date("2025-01-01"),
      confidence: 0.9,
      source: "email_forward",
      suggestedEnvelopeId: "env-other-user",
    })

    expect(out.route).toBe("pending")
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(prisma.pendingTransaction.create).toHaveBeenCalled()
  })

  it("uses encrypted payee/notes when user has publicKey", async () => {
    const { prisma } = await import("@/lib/db")
    const { encryptFieldForUser } = await import("@/lib/server-encrypt")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      publicKey: "mypk",
    } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({
      id: "env1",
    } as never)
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "t2" } as never)

    await routeTransaction("u1", {
      payee: "Coffee Shop",
      amount: 5,
      date: new Date("2025-01-01"),
      notes: "morning coffee",
      confidence: 0.9,
      source: "email_forward",
      suggestedEnvelopeId: "env1",
    })

    expect(encryptFieldForUser).toHaveBeenCalledWith("Coffee Shop", "mypk")
    expect(encryptFieldForUser).toHaveBeenCalledWith("morning coffee", "mypk")
    const call = vi.mocked(prisma.transaction.create).mock.calls[0][0]
    expect(call.data.payee).toBe("enc:Coffee Shop")
    expect(call.data.notes).toBe("enc:morning coffee")
  })

  it("falls back to plaintext payee/notes when user has no publicKey", async () => {
    const { prisma } = await import("@/lib/db")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      publicKey: null,
    } as never)
    vi.mocked(prisma.pendingTransaction.create).mockResolvedValue({ id: "p3" } as never)

    await routeTransaction("u1", {
      payee: "Gas Station",
      amount: 40,
      date: new Date("2025-01-01"),
      notes: "fill up",
      confidence: 0.3,
      source: "sms",
      suggestedEnvelopeId: null,
    })

    const call = vi.mocked(prisma.pendingTransaction.create).mock.calls[0][0]
    expect(call.data.payee).toBe("Gas Station")
    expect(call.data.notes).toBe("fill up")
  })

  it("defaults tags to '[]' when not provided", async () => {
    const { prisma } = await import("@/lib/db")
    const { routeTransaction } = await import("@/lib/confidence-router")
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ publicKey: "pk" } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({ id: "env2" } as never)
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "t3" } as never)

    await routeTransaction("u1", {
      payee: "Market",
      amount: 15,
      date: new Date("2025-01-01"),
      confidence: 0.9,
      source: "receipt_scan",
      suggestedEnvelopeId: "env2",
    })

    const call = vi.mocked(prisma.transaction.create).mock.calls[0][0]
    expect(call.data.tags).toBe("[]")
  })
})
