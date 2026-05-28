// @vitest-environment node
/**
 * Tests that PUT /api/user/settings validates monthlyIncome before writing
 * to the database — prevents negative or non-finite values from corrupting
 * sweep / funding calculations.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}))

const { userUpdate, userFindUnique } = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      update: userUpdate,
      findUnique: userFindUnique,
    },
  },
}))

import { PUT } from "@/app/api/user/settings/route"
import { NextRequest } from "next/server"

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/user/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const baseUpdateResult = {
  monthlyIncome: 5000,
  payCadence: "monthly",
  payDays: [],
  payDayOfWeek: null,
  lastPaydayAt: null,
  estimatedAnnualIncome: null,
  sweepDefaultPolicy: "reset",
  sweepDefaultCapMultiplier: null,
  savingsExperience: "engaged",
  onboardingComplete: true,
  walkthroughCompleted: false,
  setupGuideSnoozedUntil: null,
  setupGuideDismissed: false,
  setupGuideShowOnDashboard: false,
  btcDisplayUnit: "sats",
  opportunityCostEnabled: false,
  receiptInboxToken: null,
  name: "Test",
  nostrDmEnabled: false,
  emailFeatureUpdates: true,
  emailFeedbackRequests: true,
  emailRecurringReminders: true,
  emailRenewalReminders: true,
  emailImportAlerts: true,
}

describe("PUT /api/user/settings — monthlyIncome validation", () => {
  beforeEach(() => {
    userUpdate.mockReset()
    userFindUnique.mockReset()
    userUpdate.mockResolvedValue(baseUpdateResult as never)
  })

  it("accepts a valid positive monthlyIncome", async () => {
    const res = await PUT(makeRequest({ monthlyIncome: 5000 }))
    expect(res.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledTimes(1)
  })

  it("rejects a negative monthlyIncome with 400", async () => {
    const res = await PUT(makeRequest({ monthlyIncome: -1 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/monthlyIncome/)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects a non-finite monthlyIncome (Infinity becomes null in JSON, client would send string)", async () => {
    // A malicious client can send a JSON string or out-of-range number
    const req = new NextRequest("http://localhost/api/user/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"monthlyIncome": "Infinity"}',
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects null monthlyIncome with 400 (field is non-nullable Float)", async () => {
    const req = new NextRequest("http://localhost/api/user/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"monthlyIncome": null}',
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects a value exceeding the decimal precision maximum", async () => {
    const res = await PUT(makeRequest({ monthlyIncome: 99_999_999_999 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/monthlyIncome/)
    expect(userUpdate).not.toHaveBeenCalled()
  })
})
