// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const findUniqueMock = vi.fn()
const createBatchMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}))
vi.mock("@/lib/envelope-funding", () => ({
  createIrregularIncomeBatch: (...args: unknown[]) => createBatchMock(...args),
}))

import { POST } from "@/app/api/transactions/irregular-income/route"

const userId = "user-irr"

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/transactions/irregular-income", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  )
}

describe("POST /api/transactions/irregular-income", () => {
  beforeEach(() => {
    authMock.mockReset()
    findUniqueMock.mockReset()
    createBatchMock.mockReset()
    authMock.mockResolvedValue({ user: { id: userId } })
    findUniqueMock.mockResolvedValue({
      monthlyIncome: 5000,
      publicKey: "pk-test",
    })
    createBatchMock.mockResolvedValue(2)
  })

  it("returns plain error when batch creates nothing", async () => {
    createBatchMock.mockResolvedValue(0)
    const res = await post({
      amount: 10,
      date: "2026-05-01",
      payee: "Client",
      distributionMode: "envelopes",
      distributionBehavior: "add_budget",
      fundOverageFromSavings: false,
      envelopeAllocations: [{ envelopeId: "e1", amountUsd: 10 }],
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/Could not record extra income/i)
    expect(data.error).not.toMatch(/encryption/i)
  })

  it("requires Secure Your Data setup when public key missing", async () => {
    findUniqueMock.mockResolvedValue({ monthlyIncome: 5000, publicKey: null })
    const res = await post({
      amount: 100,
      date: "2026-05-01",
      payee: "Client",
      distributionMode: "savings",
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/Secure Your Data/i)
    expect(data.error).not.toMatch(/encryption key/i)
  })
})
