import { prisma } from "@/lib/db"
import { sendNotificationEmailVerificationCode } from "@/lib/email"
import { normalizeNotificationEmail } from "@/lib/notification-contact"

const RATE_LIMIT_MS = 60_000
const CODE_TTL_MS = 10 * 60_000

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
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

export async function sendNotificationEmailLinkCode(userId: string, email: string) {
  const normalizedEmail = normalizeNotificationEmail(email)
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new NotificationEmailLinkError("INVALID_EMAIL", "Valid email is required")
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })
  if (!user) {
    throw new NotificationEmailLinkError("UNAUTHORIZED", "Unauthorized", 401)
  }
  if (user.email?.toLowerCase() === normalizedEmail) {
    throw new NotificationEmailLinkError(
      "ALREADY_LOGIN_EMAIL",
      "That is already your sign-in email. Notifications will be sent there.",
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
  const normalizedEmail = normalizeNotificationEmail(email)
  const trimmedCode = code.trim()
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new NotificationEmailLinkError("INVALID_EMAIL", "Valid email is required")
  }
  if (!/^[0-9]{6}$/.test(trimmedCode)) {
    throw new NotificationEmailLinkError("INVALID_CODE", "Enter the 6-digit code")
  }

  await assertEmailAvailableForNotifications(userId, normalizedEmail)

  const record = await prisma.emailCode.findFirst({
    where: { email: normalizedEmail, code: trimmedCode, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  })
  if (!record) {
    throw new NotificationEmailLinkError("INVALID_CODE", "Invalid or expired code")
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      notificationEmail: normalizedEmail,
      notificationEmailVerified: new Date(),
    },
    select: {
      notificationEmail: true,
      notificationEmailVerified: true,
    },
  })
  await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })

  return {
    notificationEmail: user.notificationEmail,
    notificationEmailVerified: user.notificationEmailVerified?.toISOString() ?? null,
  }
}

export async function unlinkNotificationEmail(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      notificationEmail: null,
      notificationEmailVerified: null,
    },
  })
  return { notificationEmail: null, notificationEmailVerified: null }
}
