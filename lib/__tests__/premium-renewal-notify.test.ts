import { beforeEach, describe, expect, it, vi } from "vitest"

const userFindUnique = vi.fn()
const reminderAlreadyLogged = vi.fn()
const recordRenewalReminderLog = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
  },
}))

vi.mock("@/lib/premium-renewal-server", () => ({
  renewalReminderAlreadyLogged: (...args: unknown[]) => reminderAlreadyLogged(...args),
  recordRenewalReminderLog: (...args: unknown[]) => recordRenewalReminderLog(...args),
}))

const sendPremiumRenewalReminderEmail = vi.fn().mockResolvedValue(undefined)
const sendPremiumRenewalReminderDm = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/email", () => ({
  sendPremiumRenewalReminderEmail: (...args: unknown[]) => sendPremiumRenewalReminderEmail(...args),
}))

vi.mock("@/lib/nostr-dm", () => ({
  sendPremiumRenewalReminderDm: (...args: unknown[]) => sendPremiumRenewalReminderDm(...args),
}))

describe("notifyPremiumRenewalReminder", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    reminderAlreadyLogged.mockReset()
    recordRenewalReminderLog.mockReset()
    sendPremiumRenewalReminderEmail.mockClear()
    sendPremiumRenewalReminderDm.mockClear()
    reminderAlreadyLogged.mockResolvedValue(false)
    recordRenewalReminderLog.mockResolvedValue(undefined)
  })

  it("sends email and nostr once and records dedup logs", async () => {
    userFindUnique.mockResolvedValue({
      email: "user@example.com",
      notificationEmails: [],
      nostrPubkey: "npub1test",
      nostrDmEnabled: true,
      emailRenewalReminders: true,
      emailUnsubscribeToken: "tok",
    })

    const { notifyPremiumRenewalReminder } = await import("../notify")
    const expiry = new Date("2026-06-15T00:00:00.000Z")
    const result = await notifyPremiumRenewalReminder({
      userId: "u1",
      source: "trial",
      expiry,
      kind: 14,
    })

    expect(result).toEqual({ emailSent: true, nostrSent: true })
    expect(sendPremiumRenewalReminderEmail).toHaveBeenCalledTimes(1)
    expect(sendPremiumRenewalReminderDm).toHaveBeenCalledTimes(1)
    expect(recordRenewalReminderLog).toHaveBeenCalledWith("u1", "trial:2026-06-15:14", "email")
    expect(recordRenewalReminderLog).toHaveBeenCalledWith("u1", "trial:2026-06-15:14", "nostr")
  })

  it("skips channels already logged", async () => {
    userFindUnique.mockResolvedValue({
      email: "user@example.com",
      notificationEmails: [],
      nostrPubkey: "npub1test",
      nostrDmEnabled: true,
      emailRenewalReminders: true,
      emailUnsubscribeToken: "tok",
    })
    reminderAlreadyLogged.mockResolvedValue(true)

    const { notifyPremiumRenewalReminder } = await import("../notify")
    const result = await notifyPremiumRenewalReminder({
      userId: "u1",
      source: "membership",
      expiry: new Date("2026-06-15T00:00:00.000Z"),
      kind: 3,
    })

    expect(result).toEqual({ emailSent: false, nostrSent: false })
    expect(sendPremiumRenewalReminderEmail).not.toHaveBeenCalled()
    expect(sendPremiumRenewalReminderDm).not.toHaveBeenCalled()
  })
})
