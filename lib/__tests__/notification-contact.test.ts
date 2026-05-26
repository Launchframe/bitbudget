import { describe, expect, it } from "vitest"
import {
  outboundNotificationEmail,
  outboundNotificationEmails,
  parseNotificationEmail,
  userAllowsNostrDm,
  userHasAnyNotificationChannel,
  userHasEmailNotificationChannel,
} from "@/lib/notification-contact"

describe("notification-contact", () => {
  it("parses valid notification emails and rejects malformed input", () => {
    expect(parseNotificationEmail("  Notify@Example.com  ")).toBe("notify@example.com")
    expect(parseNotificationEmail("bad")).toBeNull()
    expect(parseNotificationEmail("a@b")).toBeNull()
    expect(parseNotificationEmail("has space@example.com")).toBeNull()
    expect(parseNotificationEmail("bad\n@example.com")).toBeNull()
  })

  it("includes login email and all verified notification emails", () => {
    expect(
      outboundNotificationEmails({
        email: "login@example.com",
        notificationEmails: [
          { email: "work@example.com", verifiedAt: new Date() },
          { email: "personal@example.com", verifiedAt: new Date() },
        ],
      }),
    ).toEqual(["login@example.com", "work@example.com", "personal@example.com"])
  })

  it("dedupes login email if also listed as notification address", () => {
    expect(
      outboundNotificationEmails({
        email: "same@example.com",
        notificationEmails: [{ email: "same@example.com", verifiedAt: new Date() }],
      }),
    ).toEqual(["same@example.com"])
  })

  it("uses verified notification emails when no login email", () => {
    expect(
      outboundNotificationEmails({
        email: null,
        notificationEmails: [
          { email: "a@example.com", verifiedAt: new Date() },
          { email: "b@example.com", verifiedAt: new Date() },
        ],
      }),
    ).toEqual(["a@example.com", "b@example.com"])
  })

  it("ignores unverified notification rows", () => {
    expect(
      outboundNotificationEmails({
        email: null,
        notificationEmails: [{ email: "pending@example.com", verifiedAt: null }],
      }),
    ).toEqual([])
  })

  it("requires opt-in for nostr DMs", () => {
    expect(
      userAllowsNostrDm({ nostrPubkey: "a".repeat(64), nostrDmEnabled: true }),
    ).toBe(true)
    expect(
      userAllowsNostrDm({ nostrPubkey: "a".repeat(64), nostrDmEnabled: false }),
    ).toBe(false)
  })

  it("detects email and any-channel helpers", () => {
    expect(userHasEmailNotificationChannel({ email: "a@b.com" })).toBe(true)
    expect(
      userHasEmailNotificationChannel({
        notificationEmails: [{ email: "n@b.com", verifiedAt: new Date() }],
      }),
    ).toBe(true)
    expect(outboundNotificationEmail({ email: "a@b.com" })).toBe("a@b.com")
    expect(
      userHasAnyNotificationChannel({
        nostrPubkey: "a".repeat(64),
        nostrDmEnabled: true,
      }),
    ).toBe(true)
  })
})
