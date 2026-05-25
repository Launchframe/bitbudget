import { describe, expect, it } from "vitest"
import {
  COMMUNICATION_PREFERENCE_KEYS,
  emailPreferenceUpdateData,
  normalizeCommunicationPreferences,
  parseUnsubscribePreference,
  preferenceColumnForCategory,
  userAllowsCommunicationEmail,
} from "../communication-preferences"

describe("communication preferences", () => {
  it("defaults every preference to enabled", () => {
    expect(normalizeCommunicationPreferences({})).toEqual({
      featureUpdates: true,
      feedbackRequests: true,
      recurringReminders: true,
      renewalReminders: true,
      importAlerts: true,
    })
  })

  it("maps API preference keys to user email fields", () => {
    expect(emailPreferenceUpdateData({ feedbackRequests: false, importAlerts: true })).toEqual({
      emailFeedbackRequests: false,
      emailImportAlerts: true,
    })
  })

  it("treats security alerts as mandatory", () => {
    expect(preferenceColumnForCategory("securityAlerts")).toBeNull()
  })

  it("blocks optional emails only when that category is disabled", () => {
    expect(userAllowsCommunicationEmail({ emailRenewalReminders: false }, "renewal_reminders")).toBe(false)
    expect(userAllowsCommunicationEmail({ emailRenewalReminders: null }, "renewal_reminders")).toBe(true)
  })

  it("keeps the supported key list stable for settings and unsubscribe flows", () => {
    expect(COMMUNICATION_PREFERENCE_KEYS).toEqual([
      "featureUpdates",
      "feedbackRequests",
      "recurringReminders",
      "renewalReminders",
      "importAlerts",
    ])
  })

  it("parses unsubscribe query params in camelCase or snake_case", () => {
    expect(parseUnsubscribePreference("all")).toBe("all")
    expect(parseUnsubscribePreference("renewalReminders")).toBe("renewalReminders")
    expect(parseUnsubscribePreference("renewal_reminders")).toBe("renewalReminders")
    expect(parseUnsubscribePreference("feature_updates")).toBe("featureUpdates")
    expect(parseUnsubscribePreference("invalid")).toBeNull()
    expect(parseUnsubscribePreference(null)).toBeNull()
  })
})
