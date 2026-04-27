import { describe, expect, it } from "vitest"
import {
  outboundNotificationEmail,
  userAllowsNostrDm,
  userHasEmailNotificationChannel,
} from "@/lib/notification-contact"

describe("notification-contact", () => {
  it("prefers login email over notification email", () => {
    expect(
      outboundNotificationEmail({
        email: "login@example.com",
        notificationEmail: "notify@example.com",
        notificationEmailVerified: new Date(),
      }),
    ).toBe("login@example.com")
  })

  it("uses verified notification email when no login email", () => {
    expect(
      outboundNotificationEmail({
        email: null,
        notificationEmail: "notify@example.com",
        notificationEmailVerified: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("notify@example.com")
  })

  it("ignores unverified notification email", () => {
    expect(
      outboundNotificationEmail({
        email: null,
        notificationEmail: "notify@example.com",
        notificationEmailVerified: null,
      }),
    ).toBeNull()
  })

  it("requires opt-in for nostr DMs", () => {
    expect(
      userAllowsNostrDm({ nostrPubkey: "a".repeat(64), nostrDmEnabled: true }),
    ).toBe(true)
    expect(
      userAllowsNostrDm({ nostrPubkey: "a".repeat(64), nostrDmEnabled: false }),
    ).toBe(false)
    expect(userAllowsNostrDm({ nostrPubkey: null, nostrDmEnabled: true })).toBe(false)
  })

  it("detects any email channel", () => {
    expect(userHasEmailNotificationChannel({ email: "a@b.com" })).toBe(true)
    expect(
      userHasEmailNotificationChannel({
        notificationEmail: "n@b.com",
        notificationEmailVerified: new Date(),
      }),
    ).toBe(true)
    expect(userHasEmailNotificationChannel({ nostrPubkey: "a".repeat(64) })).toBe(false)
  })
})
