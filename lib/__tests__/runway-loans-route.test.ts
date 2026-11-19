// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    btcLoan: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { DELETE, GET, PATCH, POST } from "@/app/api/runway/loans/route"

const userId = "user_1"

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "loan_1",
    userId,
    label: "Unchained 12mo",
    principalUsd: new Prisma.Decimal(50000),
    apr: new Prisma.Decimal("0.1"),
    openedOn: "2026-01-01",
    maturityOn: "2027-01-01",
    collateralSats: BigInt(100_000_000),
    lenderSellPriceUsd: new Prisma.Decimal(40000),
    payoffStyle: "accrued",
    maturityBillOverrideUsd: new Prisma.Decimal(60000),
    status: "open",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  }
}

function authed() {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
}

describe("runway loans route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authed()
  })

  it("returns 401 for every method when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const getRes = await GET(new NextRequest("http://localhost/api/runway/loans"))
    const postRes = await POST(
      new NextRequest("http://localhost/api/runway/loans", {
        method: "POST",
        body: JSON.stringify({ label: "x" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    const patchRes = await PATCH(
      new NextRequest("http://localhost/api/runway/loans", {
        method: "PATCH",
        body: JSON.stringify({ id: "loan_1", label: "x" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    const deleteRes = await DELETE(
      new NextRequest("http://localhost/api/runway/loans?id=loan_1", { method: "DELETE" }),
    )
    expect(getRes.status).toBe(401)
    expect(postRes.status).toBe(401)
    expect(patchRes.status).toBe(401)
    expect(deleteRes.status).toBe(401)
    expect(prisma.btcLoan.findMany).not.toHaveBeenCalled()
    expect(prisma.btcLoan.create).not.toHaveBeenCalled()
    expect(prisma.btcLoan.updateMany).not.toHaveBeenCalled()
    expect(prisma.btcLoan.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects an impossible asOf before reading loans", async () => {
    const res = await GET(
      new NextRequest(
        "http://localhost/api/runway/loans?btcPriceUsd=100000&asOf=2026-02-31",
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/valid calendar date/i)
    expect(prisma.btcLoan.findMany).not.toHaveBeenCalled()
  })

  it("lists only the session user's loans and honors a stored bill override", async () => {
    vi.mocked(prisma.btcLoan.findMany).mockResolvedValue([loanRow()] as never)
    const res = await GET(
      new NextRequest(
        "http://localhost/api/runway/loans?btcPriceUsd=100000&asOf=2027-01-01",
      ),
    )
    expect(res.status).toBe(200)
    expect(prisma.btcLoan.findMany).toHaveBeenCalledWith({
      where: { userId },
      orderBy: { createdAt: "desc" },
    })
    const body = await res.json()
    expect(body.loans).toHaveLength(1)
    expect(body.loans[0].userId).toBeUndefined()
    expect(body.loans[0].maturityBillOverrideUsd).toBe(60000)
    expect(body.loans[0].summary.billAtMaturityUsd).toBeCloseTo(60000, 6)
    expect(body.loans[0].summary.amountDueTodayUsd).toBeCloseTo(60000, 6)
  })

  it("creates a loan for the session user and ignores a body userId", async () => {
    vi.mocked(prisma.btcLoan.create).mockResolvedValue(loanRow() as never)
    const res = await POST(
      new NextRequest("http://localhost/api/runway/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "someone_else",
          label: "Unchained 12mo",
          principalUsd: 50000,
          apr: 0.1,
          openedOn: "2026-01-01",
          maturityOn: "2027-01-01",
          collateralSats: 100_000_000,
          lenderSellPriceUsd: 40000,
          payoffStyle: "accrued",
        }),
      }),
    )
    expect(res.status).toBe(201)
    const createArg = vi.mocked(prisma.btcLoan.create).mock.calls[0]?.[0]
    expect(createArg?.data.userId).toBe(userId)
    const body = await res.json()
    expect(body.loan.id).toBe("loan_1")
    expect(body.loan.userId).toBeUndefined()
  })

  it("returns 404 when the loan is not owned by the session user", async () => {
    vi.mocked(prisma.btcLoan.findFirst).mockResolvedValue(null)
    const res = await PATCH(
      new NextRequest("http://localhost/api/runway/loans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "loan_other", label: "Renamed" }),
      }),
    )
    expect(res.status).toBe(404)
    expect(prisma.btcLoan.findFirst).toHaveBeenCalledWith({
      where: { id: "loan_other", userId },
    })
    expect(prisma.btcLoan.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a maturity date before the stored open date", async () => {
    vi.mocked(prisma.btcLoan.findFirst).mockResolvedValue(loanRow() as never)
    const res = await PATCH(
      new NextRequest("http://localhost/api/runway/loans?id=loan_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maturityOn: "2025-06-01" }),
      }),
    )
    expect(res.status).toBe(400)
    expect(prisma.btcLoan.updateMany).not.toHaveBeenCalled()
  })

  it("writes both dates when only the open date changes", async () => {
    const existing = loanRow()
    vi.mocked(prisma.btcLoan.findFirst)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce(loanRow({ openedOn: "2026-06-01" }) as never)
    vi.mocked(prisma.btcLoan.updateMany).mockResolvedValue({ count: 1 })
    const res = await PATCH(
      new NextRequest("http://localhost/api/runway/loans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "loan_1", openedOn: "2026-06-01" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.btcLoan.updateMany).toHaveBeenCalledWith({
      where: { id: "loan_1", userId },
      data: { openedOn: "2026-06-01", maturityOn: "2027-01-01" },
    })
  })

  it("deletes only a loan owned by the session user", async () => {
    vi.mocked(prisma.btcLoan.deleteMany).mockResolvedValue({ count: 1 })
    const res = await DELETE(
      new NextRequest("http://localhost/api/runway/loans?id=loan_1", { method: "DELETE" }),
    )
    expect(res.status).toBe(200)
    expect(prisma.btcLoan.deleteMany).toHaveBeenCalledWith({
      where: { id: "loan_1", userId },
    })
    const body = await res.json()
    expect(body).toEqual({ success: true, deletedId: "loan_1" })
  })

  it("returns 404 when delete matches no owned row", async () => {
    vi.mocked(prisma.btcLoan.deleteMany).mockResolvedValue({ count: 0 })
    const res = await DELETE(
      new NextRequest("http://localhost/api/runway/loans?id=loan_other", { method: "DELETE" }),
    )
    expect(res.status).toBe(404)
    expect(prisma.btcLoan.deleteMany).toHaveBeenCalledWith({
      where: { id: "loan_other", userId },
    })
  })
})
