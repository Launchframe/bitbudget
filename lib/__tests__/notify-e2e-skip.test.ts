import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendReferralAcceptedEmail = vi.fn()
const sendReferralActivatedEmail = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/email", () => ({
  sendReferralAcceptedEmail,
  sendReferralActivatedEmail,
  sendAdminDigestEmail: vi.fn(),
  sendGratisExpiredEmail: vi.fn(),
  sendGratisExpiringEmail: vi.fn(),
  sendSurveyCompletedAdminEmail: vi.fn(),
  sendTrialExpiredEmail: vi.fn(),
  sendTrialEndingEmail: vi.fn(),
}))

vi.mock("@/lib/nostr-dm", () => ({
  sendReferralAcceptedDm: vi.fn(),
  sendReferralActivatedDm: vi.fn(),
  sendAdminDigestDm: vi.fn(),
  sendGratisExpiredDm: vi.fn(),
  sendGratisExpiringDm: vi.fn(),
  sendTrialExpiredDm: vi.fn(),
  sendTrialEndingDm: vi.fn(),
}))

describe("notify — E2E_TEST skips outbound", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.E2E_TEST = "true"
  })

  afterEach(() => {
    delete process.env.E2E_TEST
    vi.clearAllMocks()
  })

  it("notifyReferralAccepted does not send email", async () => {
    const { notifyReferralAccepted } = await import("../notify")
    await notifyReferralAccepted({ referrerId: "r1", refereeName: "Ref" })
    expect(sendReferralAcceptedEmail).not.toHaveBeenCalled()
  })

  it("notifyReferralActivated does not send email", async () => {
    const { notifyReferralActivated } = await import("../notify")
    await notifyReferralActivated({
      referrerId: "r1",
      refereeUserId: "u1",
      rewardMonths: 1,
      newGratisUntil: new Date(),
    })
    expect(sendReferralActivatedEmail).not.toHaveBeenCalled()
  })
})
