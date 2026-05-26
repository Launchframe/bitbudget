import { randomInt } from "node:crypto"
import { prisma } from "@/lib/db"
import { sendNotificationEmailVerificationCode } from "@/lib/email"
import {
  MAX_NOTIFICATION_EMAILS_PER_USER,
  normalizeNotificationEmail,
  parseNotificationEmail,
} from "@/lib/notification-contact"

const RATE_LIMIT_MS = 60_000
const CODE_TTL_MS = 10 * 60_000
export const MAX_VERIFY_CODE_ATTEMPTS = 5

function generateCode(): string {
  return String(randomInt(100_000, 1_000_000))
}

export class NotificationEmailLinkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = "NotificationEmailLinkError"
  }
}

async function assertEmailAvailableForNotifications(userId: string, normalizedEmail: string) {
  const loginOwner = await prisma.user.findFirst({
    where: { email: normalizedEmail, NOT: { id: userId } },
    select: { id: true },
  })
  if (loginOwner) {
    throw new NotificationEmailLinkError(
      "EMAIL_IN_USE",
      "That address is already used to sign in to another BitBudget account.",
      409,
    )
  }
}

export async function listUserNotificationEmails(userId: string) {
  return prisma.userNotificationEmail.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, verifiedAt: true },
  })
}

export async function sendNotificationEmailLinkCode(userId: string, email: string) {
  const normalizedEmail = parseNotificationEmail(email)
  if (!normalizedEmail) {
    throw new NotificationEmailLinkError("INVALID_EMAIL", "Valid email is required")
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      _count: { select: { notificationEmails: true } },
    },
  })
  if (!user) {
    throw new NotificationEmailLinkError("UNAUTHORIZED", "Unauthorized", 401)
  }
  if (user.email?.toLowerCase() === normalizedEmail) {
    throw new NotificationEmailLinkError(
      "ALREADY_LOGIN_EMAIL",
      "That is already your sign-in email. Notifications are already sent there.",
    )
  }

  const existing = await prisma.userNotificationEmail.findUnique({
    where: { userId_email: { userId, email: normalizedEmail } },
    select: { id: true },
  })
  if (existing) {
    throw new NotificationEmailLinkError(
      "ALREADY_LINKED",
      "That address is already linked for notifications.",
    )
  }

  if (user._count.notificationEmails >= MAX_NOTIFICATION_EMAILS_PER_USER) {
    throw new NotificationEmailLinkError(
      "LIMIT_REACHED",
      `You can link up to ${MAX_NOTIFICATION_EMAILS_PER_USER} notification email addresses.`,
      400,
    )
  }

  await assertEmailAvailableForNotifications(userId, normalizedEmail)

  if (process.env.E2E_TEST === "true" && normalizedEmail.endsWith("@bitbudget.test")) {
    const e2eCode = process.env.E2E_EMAIL_CODE?.trim() ?? ""
    if (!/^[0-9]{6}$/.test(e2eCode)) {
      throw new NotificationEmailLinkError(
        "E2E_MISCONFIGURED",
        "E2E email verification is misconfigured",
        500,
      )
    }
    await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })
    await prisma.emailCode.create({
      data: {
        email: normalizedEmail,
        code: e2eCode,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    })
    return { sent: true as const }
  }

  const recent = await prisma.emailCode.findFirst({
    where: {
      email: normalizedEmail,
      createdAt: { gt: new Date(Date.now() - RATE_LIMIT_MS) },
    },
    orderBy: { createdAt: "desc" },
  })
  if (recent) {
    throw new NotificationEmailLinkError(
      "RATE_LIMITED",
      "Please wait before requesting another code",
      429,
    )
  }

  await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })
  const code = generateCode()
  await prisma.emailCode.create({
    data: {
      email: normalizedEmail,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  })
  await sendNotificationEmailVerificationCode(normalizedEmail, code)
  return { sent: true as const }
}

export async function verifyNotificationEmailLink(userId: string, email: string, code: string) {
  const normalizedEmail = parseNotificationEmail(email)
  const trimmedCode = code.trim()
  if (!normalizedEmail) {
    throw new NotificationEmailLinkError("INVALID_EMAIL", "Valid email is required")
  }
  if (!/^[0-9]{6}$/.test(trimmedCode)) {
    throw new NotificationEmailLinkError("INVALID_CODE", "Enter the 6-digit code")
  }

  await assertEmailAvailableForNotifications(userId, normalizedEmail)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      _count: { select: { notificationEmails: true } },
    },
  })
  if (!user) {
    throw new NotificationEmailLinkError("UNAUTHORIZED", "Unauthorized", 401)
  }
  if (user.email?.toLowerCase() === normalizedEmail) {
    throw new NotificationEmailLinkError(
      "ALREADY_LOGIN_EMAIL",
      "That is already your sign-in email.",
    )
  }

  const activeCode = await prisma.emailCode.findFirst({
    where: { email: normalizedEmail, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  })
  if (!activeCode) {
    throw new NotificationEmailLinkError("INVALID_CODE", "Invalid or expired code")
  }
  if (activeCode.code !== trimmedCode) {
    const failedAttempts = activeCode.failedAttempts + 1
    if (failedAttempts >= MAX_VERIFY_CODE_ATTEMPTS) {
      await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })
      throw new NotificationEmailLinkError(
        "RATE_LIMITED",
        "Too many incorrect attempts. Request a new code.",
        429,
      )
    }
    await prisma.emailCode.update({
      where: { id: activeCode.id },
      data: { failedAttempts },
    })
    throw new NotificationEmailLinkError("INVALID_CODE", "Invalid or expired code")
  }

  const existing = await prisma.userNotificationEmail.findUnique({
    where: { userId_email: { userId, email: normalizedEmail } },
    select: { id: true },
  })
  if (!existing && user._count.notificationEmails >= MAX_NOTIFICATION_EMAILS_PER_USER) {
    throw new NotificationEmailLinkError(
      "LIMIT_REACHED",
      `You can link up to ${MAX_NOTIFICATION_EMAILS_PER_USER} notification email addresses.`,
      400,
    )
  }

  const row = await prisma.userNotificationEmail.upsert({
    where: { userId_email: { userId, email: normalizedEmail } },
    create: {
      userId,
      email: normalizedEmail,
      verifiedAt: new Date(),
    },
    update: { verifiedAt: new Date() },
    select: { id: true, email: true, verifiedAt: true },
  })
  await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })

  const notificationEmails = await listUserNotificationEmails(userId)
  return {
    email: row,
    notificationEmails: notificationEmails.map((r) => ({
      id: r.id,
      email: r.email,
      verifiedAt: r.verifiedAt.toISOString(),
    })),
  }
}

export async function unlinkNotificationEmail(userId: string, emailOrId: string) {
  const trimmed = emailOrId.trim()
  if (!trimmed) {
    throw new NotificationEmailLinkError("INVALID_TARGET", "Email or id is required")
  }

  const byId = await prisma.userNotificationEmail.findFirst({
    where: { id: trimmed, userId },
    select: { id: true },
  })
  if (byId) {
    await prisma.userNotificationEmail.delete({ where: { id: byId.id } })
  } else {
    const normalizedEmail = normalizeNotificationEmail(trimmed)
    const deleted = await prisma.userNotificationEmail.deleteMany({
      where: { userId, email: normalizedEmail },
    })
    if (deleted.count === 0) {
      throw new NotificationEmailLinkError("NOT_FOUND", "Notification email not found", 404)
    }
  }

  const notificationEmails = await listUserNotificationEmails(userId)
  return {
    notificationEmails: notificationEmails.map((r) => ({
      id: r.id,
      email: r.email,
      verifiedAt: r.verifiedAt.toISOString(),
    })),
  }
}
