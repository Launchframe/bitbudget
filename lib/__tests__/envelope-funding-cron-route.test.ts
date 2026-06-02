// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const processEnvelopeFundingCronMock = vi.fn()
const processAllRecurringFundingRulesMock = vi.fn()

vi.mock("@/lib/envelope-funding-cron", () => ({
  processEnvelopeFundingCron: (...args: unknown[]) => processEnvelopeFundingCronMock(...args),
}))

vi.mock("@/lib/recurring-funding-processor", () => ({
  processAllRecurringFundingRules: (...args: unknown[]) =>
    processAllRecurringFundingRulesMock(...args),
}))

const cronRunCreate = vi.fn()
const cronRunUpdate = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    cronRun: {
      create: (...args: unknown[]) => cronRunCreate(...args),
      update: (...args: unknown[]) => cronRunUpdate(...args),
    },
  },
}))

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))
vi.mock("@/lib/alert", () => ({ sendAlert: vi.fn(async () => ({ sent: false })) }))

import { GET } from "@/app/api/cron/envelope-funding/route"

describe("GET /api/cron/envelope-funding", () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret"
    processEnvelopeFundingCronMock.mockReset()
    processAllRecurringFundingRulesMock.mockReset()
    cronRunCreate.mockReset()
    cronRunUpdate.mockReset()
    cronRunCreate.mockResolvedValue({ id: "run-1" })
    cronRunUpdate.mockResolvedValue({})
    processEnvelopeFundingCronMock.mockResolvedValue({
      usersProcessed: 2,
      paycheckCreditsCreated: 1,
      allocationLegsCreated: 3,
      sweepTransactionsCreated: 0,
    })
    processAllRecurringFundingRulesMock.mockResolvedValue({
      rulesProcessed: 1,
      legsCreated: 4,
    })
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalSecret
    }
  })

  it("rejects missing cron auth", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/cron/envelope-funding"),
    )
    expect(res.status).toBe(401)
    expect(processEnvelopeFundingCronMock).not.toHaveBeenCalled()
  })

  it("runs funding cron and recurring funding rules", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/cron/envelope-funding", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(2)
    expect(body.recurringFundingRulesProcessed).toBe(1)
    expect(body.recurringFundingLegsCreated).toBe(4)
    expect(processEnvelopeFundingCronMock).toHaveBeenCalled()
    expect(processAllRecurringFundingRulesMock).toHaveBeenCalled()
  })
})
