import nodemailer from "nodemailer"
import {
  type CommunicationEmailCategory,
  communicationPreferenceForCategory,
} from "@/lib/communication-preferences"

const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
const APP_URL = process.env.NEXTAUTH_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL

function getTransport() {
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  }
  return null
}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const subject = `${code} is your BitBudget login code`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A; margin-bottom: 8px;">BitBudget</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 24px;">Enter this code to sign in:</p>
      <div style="background: #0D0D0D; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #F7931A;">${code}</span>
      </div>
      <p style="color: #999; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore it.</p>
    </div>
  `

  const transport = getTransport()
  if (transport) {
    await transport.sendMail({
      from: `BitBudget <${GMAIL_USER}>`,
      to: email,
      subject,
      html,
    })
    return
  }

  console.log(`\n━━━ Verification Code for ${email} ━━━`)
  console.log(`  Code: ${code}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}

export interface PreferenceEmailOptions {
  category?: CommunicationEmailCategory
  unsubscribeToken?: string | null
}

export function unsubscribeUrl(token: string, category: CommunicationEmailCategory): string | null {
  const trimmed = token.trim()
  if (!trimmed || !APP_URL) return null
  const base = APP_URL.startsWith("http") ? APP_URL : `https://${APP_URL}`
  const url = new URL("/api/user/unsubscribe", base)
  url.searchParams.set("token", trimmed)
  url.searchParams.set("category", category)
  return url.toString()
}

function withEmailFooter(html: string, options?: PreferenceEmailOptions): string {
  const category = options?.category
  const token = options?.unsubscribeToken?.trim()
  if (!category || !token) return html
  const url = unsubscribeUrl(token, category)
  if (!url) return html
  const preference = communicationPreferenceForCategory(category)
  return html.replace(
    "</div>",
    `
      <div style="border-top: 1px solid #333; margin-top: 28px; padding-top: 16px;">
        <p style="color: #999; font-size: 12px; line-height: 1.5; margin: 0 0 12px;">
          You are receiving this because ${escapeHtml(preference.emailReason)}.
        </p>
        <a href="${escapeHtml(url)}" style="display: inline-block; background: #1A1A1A; color: #F7931A; border: 1px solid #333; border-radius: 10px; padding: 10px 14px; font-size: 13px; text-decoration: none;">Unsubscribe</a>
      </div>
    </div>`,
  )
}

async function sendHtmlMail(to: string, subject: string, html: string, options?: PreferenceEmailOptions): Promise<boolean> {
  const htmlWithFooter = withEmailFooter(html, options)
  const transport = getTransport()
  if (transport && GMAIL_USER) {
    await transport.sendMail({
      from: `BitBudget <${GMAIL_USER}>`,
      to,
      subject,
      html: htmlWithFooter,
    })
    return true
  }
  console.log(`\n━━━ Email (no transport): ${subject} → ${to} ━━━\n`)
  return false
}

export async function sendReferralAcceptedEmail(to: string, refereeName: string, options?: PreferenceEmailOptions): Promise<void> {
  const subject = "Someone joined BitBudget with your referral"
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A;">Referral accepted</h2>
      <p style="color: #ccc; font-size: 15px;">${escapeHtml(refereeName)} created an account using your referral link.</p>
      <p style="color: #999; font-size: 13px;">When they connect their bank and complete a first sync, you&apos;ll earn bonus premium time.</p>
    </div>`
  await sendHtmlMail(to, subject, html, options)
}

export async function sendReferralActivatedEmail(
  to: string,
  refereeName: string,
  rewardMonths: number,
  newExpiryDate: string,
  options?: PreferenceEmailOptions,
): Promise<void> {
  const subject = "Referral activated — you earned premium time"
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A;">Referral activated</h2>
      <p style="color: #ccc; font-size: 15px;">${escapeHtml(refereeName)} connected their bank.</p>
      <p style="color: #ccc; font-size: 15px;">You earned <strong>${rewardMonths}</strong> month(s) of premium. Access now runs through <strong>${escapeHtml(newExpiryDate)}</strong>.</p>
    </div>`
  await sendHtmlMail(to, subject, html, options)
}

export async function sendGratisExpiringEmail(to: string, expiryDate: string, daysRemaining: number, options?: PreferenceEmailOptions): Promise<void> {
  const subject = `Your bonus premium ends in ${daysRemaining} day(s)`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A;">Premium ending soon</h2>
      <p style="color: #ccc;">Your referral bonus premium access ends on <strong>${escapeHtml(expiryDate)}</strong> (${daysRemaining} day(s) left).</p>
    </div>`
  await sendHtmlMail(to, subject, html, options)
}

export async function sendGratisExpiredEmail(to: string): Promise<void> {
  const subject = "Your bonus premium period has ended"
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A;">Bonus premium ended</h2>
      <p style="color: #ccc;">Your referral bonus premium access has ended. Thanks for growing BitBudget.</p>
    </div>`
  await sendHtmlMail(to, subject, html)
}

export async function sendTrialEndingEmail(to: string, expiryDate: string, daysRemaining: number, options?: PreferenceEmailOptions): Promise<void> {
  const subject = `Your premium trial ends in ${daysRemaining} day(s)`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A;">Trial ending</h2>
      <p style="color: #ccc;">Your premium trial ends on <strong>${escapeHtml(expiryDate)}</strong> (${daysRemaining} day(s) left).</p>
    </div>`
  await sendHtmlMail(to, subject, html, options)
}

export async function sendTrialExpiredEmail(to: string): Promise<void> {
  const subject = "Your premium trial has ended"
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A;">Trial ended</h2>
      <p style="color: #ccc;">Your premium trial has ended. Upgrade anytime to keep Plaid, receipt inbox, and SMS alerts.</p>
    </div>`
  await sendHtmlMail(to, subject, html)
}

export interface SurveyCompletedEmailPayload {
  userLabel: string
  triggerType: string
  rating: string | null
  favoriteFeature: string | null
  leastFavorite: string | null
  comments: string | null
  canContact: boolean | null
}

export async function sendSurveyCompletedAdminEmail(to: string, data: SurveyCompletedEmailPayload): Promise<void> {
  const subject = `Survey completed — ${data.userLabel}`
  const html = `
    <div style="font-family: monospace; font-size: 13px; color: #111; max-width: 560px;">
      <h2 style="color: #F7931A;">Survey response</h2>
      <p><strong>User:</strong> ${escapeHtml(data.userLabel)}</p>
      <p><strong>Trigger:</strong> ${escapeHtml(data.triggerType)}</p>
      <p><strong>Rating:</strong> ${escapeHtml(data.rating ?? "—")}</p>
      <p><strong>Favorite:</strong> ${escapeHtml(data.favoriteFeature ?? "—")}</p>
      <p><strong>Least favorite:</strong> ${escapeHtml(data.leastFavorite ?? "—")}</p>
      <p><strong>Comments:</strong> ${escapeHtml(data.comments ?? "—")}</p>
      <p><strong>Can contact:</strong> ${data.canContact === null ? "—" : data.canContact ? "yes" : "no"}</p>
    </div>`
  await sendHtmlMail(to, subject, html)
}

export async function sendAdminDigestEmail(to: string, bodyHtml: string): Promise<void> {
  const subject = "BitBudget — daily referral digest"
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #F7931A;">Daily digest</h2>
      ${bodyHtml}
    </div>`
  await sendHtmlMail(to, subject, html)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
