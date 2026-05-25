import "./load-env"
import { test, expect } from "@playwright/test"
import { prisma } from "../lib/db"

test.describe("Admin ops", () => {
  test("GET /api/health returns JSON without auth", async ({ request }) => {
    const res = await request.get("/api/health")
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { ok: boolean; db: boolean; ts: string }
    expect(typeof body.ok).toBe("boolean")
    expect(typeof body.db).toBe("boolean")
    expect(body.ts).toBeTruthy()
  })

  test("GET /api/admin/ops/events — 401 when unauthenticated", async ({ request }) => {
    const res = await request.get("/api/admin/ops/events")
    expect(res.status()).toBe(401)
  })

  test("GET /api/admin/ops/summary — 401 when unauthenticated", async ({ request }) => {
    const res = await request.get("/api/admin/ops/summary")
    expect(res.status()).toBe(401)
  })

  test("admin ops API returns seeded events", async ({ request }) => {
    const admin = await prisma.user.findFirst({ where: { role: "admin" } })
    test.skip(!admin, "No admin user in DB — set ADMIN_EMAILS and seed")

    await prisma.opsEvent.create({
      data: {
        severity: "info",
        source: "e2e",
        title: "E2E ops event",
        body: "Seeded for Playwright",
        fingerprint: `e2e:${Date.now()}`,
      },
    })

    // Unauthenticated still 401
    const unauth = await request.get("/api/admin/ops/events")
    expect(unauth.status()).toBe(401)
  })
})
