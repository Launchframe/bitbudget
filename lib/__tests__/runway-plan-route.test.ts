// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    runwayPlan: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { GET, PUT } from "@/app/api/runway/plan/route"

const userId = "user-1"

function uniqueConstraint() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["userId"] },
  })
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    phase: "buildup",
    quitDate: null,
    horizonMonths: 24,
    runwayIncomeUsd: new Prisma.Decimal("0"),
    livingBaselineOverrideUsd: null,
    inflationRateYear: new Prisma.Decimal("0.05"),
    stressPercent: new Prisma.Decimal("0.5"),
    growthRateYear: null,
    dipResponse: "cut",
    btcSharePreference: "half",
    borrowStance: "deep_drop",
    editedCashFloorUsd: null,
    editedBorrowCapFraction: null,
    cashOverrideUsd: null,
    bitcoinOverrideSats: null,
    plannedLines: [],
    scenarios: [],
    envelopePriorities: {},
    checkupOpenedMonthKey: null,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    ...overrides,
  }
}

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/runway/plan", {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  )
}

describe("GET /api/runway/plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
  })

  it("returns 401 when the session has no user", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayPlan.findUnique).not.toHaveBeenCalled()
  })

  it("loads only the signed-in user's plan and serializes money and sats as numbers", async () => {
    vi.mocked(prisma.runwayPlan.findUnique).mockResolvedValue(
      row({
        runwayIncomeUsd: new Prisma.Decimal("1500.01"),
        bitcoinOverrideSats: 50_000_000n,
        phase: "runway",
      }) as never,
    )
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayPlan.findUnique).toHaveBeenCalledWith({
      where: { userId },
    })
    const body = await res.json()
    expect(body).not.toHaveProperty("userId")
    expect(body.phase).toBe("runway")
    expect(body.runwayIncomeUsd).toBe(1500.01)
    expect(body.bitcoinOverrideSats).toBe(50_000_000)
    expect(body.inflationRateYear).toBe(0.05)
    expect(body.createdAt).toBe("2026-11-01T00:00:00.000Z")
    expect(prisma.runwayPlan.create).not.toHaveBeenCalled()
  })

  it("creates a plan for the session user when none exists", async () => {
    vi.mocked(prisma.runwayPlan.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.runwayPlan.create).mockResolvedValue(row() as never)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(prisma.runwayPlan.create).toHaveBeenCalledWith({
      data: { userId },
    })
    const body = await res.json()
    expect(body.phase).toBe("buildup")
    expect(body.plannedLines).toEqual([])
  })

  it("re-reads the row when a concurrent create hits the unique userId", async () => {
    vi.mocked(prisma.runwayPlan.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ phase: "runway" }) as never)
    vi.mocked(prisma.runwayPlan.create).mockRejectedValueOnce(uniqueConstraint())
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ phase: "runway" })
    expect(prisma.runwayPlan.findUnique).toHaveBeenNthCalledWith(2, {
      where: { userId },
    })
  })

  it("rethrows when the unique conflict has no row to re-read", async () => {
    vi.mocked(prisma.runwayPlan.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.runwayPlan.create).mockRejectedValueOnce(uniqueConstraint())
    await expect(GET()).rejects.toMatchObject({ code: "P2002" })
  })

  it("rethrows errors that are not a unique conflict", async () => {
    vi.mocked(prisma.runwayPlan.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.runwayPlan.create).mockRejectedValueOnce(new Error("db down"))
    await expect(GET()).rejects.toThrow("db down")
  })
})

describe("PUT /api/runway/plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.runwayPlan.upsert).mockResolvedValue(row() as never)
  })

  it("returns 401 and does not write when signed out", async () => {
    vi.mocked(auth).mockResolvedValue({ user: {} } as never)
    const res = await put({ phase: "runway" })
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayPlan.upsert).not.toHaveBeenCalled()
  })

  it("rejects invalid JSON and invalid plans before writing", async () => {
    const badJson = await put("{")
    expect(badJson.status).toBe(400)
    const badPlan = await put({ phase: "coasting" })
    expect(badPlan.status).toBe(400)
    await expect(badPlan.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Phase/),
    })
    expect(prisma.runwayPlan.upsert).not.toHaveBeenCalled()
  })

  it("upserts only the session user and ignores a userId in the body", async () => {
    vi.mocked(prisma.runwayPlan.upsert).mockResolvedValue(
      row({
        phase: "runway",
        runwayIncomeUsd: new Prisma.Decimal("1500.01"),
        bitcoinOverrideSats: 50_000_000n,
      }) as never,
    )
    const res = await put({
      userId: "someone-else",
      phase: "runway",
      runwayIncomeUsd: "1500.005",
      bitcoinOverrideSats: 50_000_000,
      plannedLines: [
        { id: "p1", group: "home", label: "Rent", monthlyUsd: 2000, mode: "add" },
      ],
    })
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.runwayPlan.upsert).mock.calls[0][0]
    expect(call.where).toEqual({ userId })
    expect(call.create.userId).toBe(userId)
    expect(call.update).not.toHaveProperty("userId")
    expect(call.create.phase).toBe("runway")
    expect(call.create.bitcoinOverrideSats).toBe(50_000_000n)
    expect((call.create.runwayIncomeUsd as Prisma.Decimal).toFixed(2)).toBe(
      "1500.01",
    )
    expect(call.create.plannedLines).toEqual([
      { id: "p1", group: "home", label: "Rent", monthlyUsd: 2000, mode: "add" },
    ])
    const body = await res.json()
    expect(body).not.toHaveProperty("userId")
    expect(body.runwayIncomeUsd).toBe(1500.01)
    expect(body.bitcoinOverrideSats).toBe(50_000_000)
  })

  it("stores defaults for fields the body omits", async () => {
    const res = await put({ phase: "runway" })
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.runwayPlan.upsert).mock.calls[0][0]
    expect(call.create.phase).toBe("runway")
    expect(call.create.userId).toBe(userId)
    expect(Number(call.create.runwayIncomeUsd)).toBe(0)
    expect(call.create.quitDate).toBeNull()
    expect(call.create.plannedLines).toEqual([])
    expect(call.create.scenarios).toEqual([])
    expect(call.create.bitcoinOverrideSats).toBeNull()
    expect(call.update).toEqual(expect.objectContaining({
      phase: "runway",
      runwayIncomeUsd: expect.anything(),
      plannedLines: [],
    }))
  })
})
