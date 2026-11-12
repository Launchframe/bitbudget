import { NextRequest } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { notifyPremiumRenewalReminder } from "@/lib/notify"
import {
  PREMIUM_EXPIRY_SOURCES,
  PREMIUM_RENEWAL_REMINDER_DAYS,
  clearExpiredTimedPremiumField,
  findUsersForExpiredNotification,
  findUsersForExpiryReminderWindow,
} from "@/lib/premium-renewal-server"
import { runCron } from "@/lib/run-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("referral-expiry", async () => {
    const now = new Date()
    let nearingSent = 0
    let expiredSent = 0
    let trialFieldsCleared = 0
    let gratisFieldsCleared = 0

    for (const source of PREMIUM_EXPIRY_SOURCES) {
      for (const daysBefore of PREMIUM_RENEWAL_REMINDER_DAYS) {
        const users = await findUsersForExpiryReminderWindow(source, daysBefore, now)
        for (const u of users) {
          const result = await notifyPremiumRenewalReminder({
            userId: u.id,
            source,
            expiry: u.expiry,
            kind: daysBefore,
          })
          if (result.emailSent || result.nostrSent) nearingSent += 1
        }
      }

      const expiredUsers = await findUsersForExpiredNotification(source, now)
      for (const u of expiredUsers) {
        const result = await notifyPremiumRenewalReminder({
          userId: u.id,
          source,
          expiry: u.expiry,
          kind: "expired",
        })
        if (result.emailSent || result.nostrSent) expiredSent += 1

        if (source === "trial") {
          await clearExpiredTimedPremiumField(u.id, source)
          trialFieldsCleared += 1
        } else if (source === "gratis") {
          await clearExpiredTimedPremiumField(u.id, source)
          gratisFieldsCleared += 1
        }
      }
    }

    return {
      nearingSent,
      expiredSent,
      trialFieldsCleared,
      gratisFieldsCleared,
      reminderDays: [...PREMIUM_RENEWAL_REMINDER_DAYS],
    }
  })
}
