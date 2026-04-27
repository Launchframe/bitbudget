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

describe("notify — communication preferences", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.E2E_TEST
  })

  afterEach(() => {
    delete process.env.E2E_TEST
    vi.clearAllMocks()
  })

  it("does not send feature update email when disabled", async () => {
    const { prisma } = await import("@/lib/db")
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      email: "user@example.com",
      notificationEmail: null,
      notificationEmailVerified: null,
      nostrPubkey: null,
      nostrDmEnabled: false,
      emailFeatureUpdates: false,
      emailFeedbackRequests: true,
      emailRecurringReminders: true,
      emailRenewalReminders: true,
      emailImportAlerts: true,
      emailUnsubscribeToken: "tok",
    } as never)

    const { notifyReferralAccepted } = await import("../notify")
    await notifyReferralAccepted({ referrerId: "r1", refereeName: "Ref" })

    expect(sendReferralAcceptedEmail).not.toHaveBeenCalled()
  })

  it("passes unsubscribe metadata when preference email is enabled", async () => {
    const { prisma } = await import("@/lib/db")
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      email: "user@example.com",
      notificationEmail: null,
      notificationEmailVerified: null,
      nostrPubkey: null,
      nostrDmEnabled: false,
      emailFeatureUpdates: true,
      emailFeedbackRequests: true,
      emailRecurringReminders: true,
      emailRenewalReminders: true,
      emailImportAlerts: true,
      emailUnsubscribeToken: "tok",
    } as never)

    const { notifyReferralAccepted } = await import("../notify")
    await notifyReferralAccepted({ referrerId: "r1", refereeName: "Ref" })

    expect(sendReferralAcceptedEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Ref",
      { category: "feature_updates", unsubscribeToken: "tok" },
    )
  })

  it("sends nostr DM only when opted in and no email channel", async () => {
    const { prisma } = await import("@/lib/db")
    const { sendReferralAcceptedDm } = await import("@/lib/nostr-dm")
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      email: null,
      notificationEmail: null,
      notificationEmailVerified: null,
      nostrPubkey: "b".repeat(64),
      nostrDmEnabled: true,
      emailFeatureUpdates: true,
      emailFeedbackRequests: true,
      emailRecurringReminders: true,
      emailRenewalReminders: true,
      emailImportAlerts: true,
      emailUnsubscribeToken: "tok",
    } as never)

    const { notifyReferralAccepted } = await import("../notify")
    await notifyReferralAccepted({ referrerId: "r1", refereeName: "Ref" })

    expect(sendReferralAcceptedEmail).not.toHaveBeenCalled()
    expect(sendReferralAcceptedDm).toHaveBeenCalled()
  })

  it("does not send nostr DM without opt-in", async () => {
    const { prisma } = await import("@/lib/db")
    const { sendReferralAcceptedDm } = await import("@/lib/nostr-dm")
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      email: null,
      notificationEmail: null,
      notificationEmailVerified: null,
      nostrPubkey: "b".repeat(64),
      nostrDmEnabled: false,
      emailFeatureUpdates: true,
      emailFeedbackRequests: true,
      emailRecurringReminders: true,
      emailRenewalReminders: true,
      emailImportAlerts: true,
      emailUnsubscribeToken: "tok",
    } as never)

    const { notifyReferralAccepted } = await import("../notify")
    await notifyReferralAccepted({ referrerId: "r1", refereeName: "Ref" })

    expect(sendReferralAcceptedEmail).not.toHaveBeenCalled()
    expect(sendReferralAcceptedDm).not.toHaveBeenCalled()
  })
})
