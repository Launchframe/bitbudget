// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    runwayPlan: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { POST } from "@/app/api/runway/checkup/opened/route"

const userId = "user-1"

function uniqueConstraint() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["userId"] },
  })
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/runway/checkup/opened", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  )
}

describe("POST /api/runway/checkup/opened", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.runwayPlan.upsert).mockResolvedValue({
      checkupOpenedMonthKey: "2026-03",
    } as never)
  })

  it("returns 401 and does not write when signed out", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await post({ monthKey: "2026-03" })
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayPlan.upsert).not.toHaveBeenCalled()
  })

  it("rejects a bad month before writing", async () => {
    const res = await post({ monthKey: "2026-13", userId: "someone-else" })
    expect(res.status).toBe(400)
    expect(prisma.runwayPlan.upsert).not.toHaveBeenCalled()
  })

  it("marks the month opened on the session user's plan", async () => {
    const res = await post({ monthKey: "2026-03", userId: "someone-else" })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayPlan.upsert).toHaveBeenCalledWith({
      where: { userId },
      create: { userId, checkupOpenedMonthKey: "2026-03" },
      update: { checkupOpenedMonthKey: "2026-03" },
      select: { checkupOpenedMonthKey: true },
    })
    await expect(res.json()).resolves.toEqual({ checkupOpenedMonthKey: "2026-03" })
  })

  it("retries the update when a concurrent first create hits the unique userId", async () => {
    vi.mocked(prisma.runwayPlan.upsert).mockRejectedValueOnce(uniqueConstraint())
    vi.mocked(prisma.runwayPlan.update).mockResolvedValue({
      checkupOpenedMonthKey: "2026-03",
    } as never)
    const res = await post({ monthKey: "2026-03" })
    expect(res.status).toBe(200)
    expect(prisma.runwayPlan.update).toHaveBeenCalledWith({
      where: { userId },
      data: { checkupOpenedMonthKey: "2026-03" },
      select: { checkupOpenedMonthKey: true },
    })
  })
})
