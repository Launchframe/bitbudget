import { prisma } from "@/lib/db"

type LinkProvider = "google" | "github"

export interface SignInMethods {
  email: string | null
  emailLinked: boolean
  nostrPubkey: string | null
  nostrLinked: boolean
  oauthProviders: LinkProvider[]
}

export interface LinkEmailInput {
  userId: string
  email: string
  code: string
}

export interface LinkNostrInput {
  userId: string
  pubkey: string
  event: string
  profileName?: string
  profileImage?: string
}

export class SignInMethodError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = "SignInMethodError"
  }
}

export function normalizeLinkEmail(email: string): string {
  return email.toLowerCase().trim()
}

export async function getSignInMethods(userId: string): Promise<SignInMethods> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      nostrPubkey: true,
      accounts: { select: { provider: true } },
    },
  })

  if (!user) {
    throw new SignInMethodError("UNAUTHORIZED", "Unauthorized", 401)
  }

  const oauthProviders = user.accounts
    .map(account => account.provider)
    .filter((provider): provider is LinkProvider => provider === "google" || provider === "github")

  return {
    email: user.email,
    emailLinked: Boolean(user.email),
    nostrPubkey: user.nostrPubkey,
    nostrLinked: Boolean(user.nostrPubkey),
    oauthProviders,
  }
}

export async function linkEmailSignInMethod({ userId, email, code }: LinkEmailInput) {
  const normalizedEmail = normalizeLinkEmail(email)
  const trimmedCode = code.trim()

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new SignInMethodError("INVALID_EMAIL", "Valid email is required")
  }
  if (!/^[0-9]{6}$/.test(trimmedCode)) {
    throw new SignInMethodError("INVALID_CODE", "Enter the 6-digit code")
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  })
  if (existing && existing.id !== userId) {
    throw new SignInMethodError(
      "EMAIL_ALREADY_LINKED",
      "That email is already linked to another BitBudget account.",
      409,
    )
  }

  const record = await prisma.emailCode.findFirst({
    where: { email: normalizedEmail, code: trimmedCode, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  })
  if (!record) {
    throw new SignInMethodError("INVALID_CODE", "Invalid or expired code")
  }

  await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })
  const user = await prisma.user.update({
    where: { id: userId },
    data: { email: normalizedEmail, emailVerified: new Date() },
    select: { email: true },
  })

  return { email: user.email, emailLinked: Boolean(user.email) }
}

export async function linkNostrSignInMethod({
  userId,
  pubkey,
  event,
  profileName,
  profileImage,
}: LinkNostrInput) {
  const trimmedPubkey = pubkey.trim()
  if (!/^[0-9a-f]{64}$/i.test(trimmedPubkey)) {
    throw new SignInMethodError("INVALID_NOSTR_PUBKEY", "Invalid Nostr public key")
  }

  let parsedEvent: { pubkey?: unknown }
  try {
    parsedEvent = JSON.parse(event)
  } catch {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }

  const { verifyEvent } = await import("nostr-tools")
  if (!verifyEvent(parsedEvent as Parameters<typeof verifyEvent>[0]) || parsedEvent.pubkey !== trimmedPubkey) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Nostr signature could not be verified")
  }

  const existing = await prisma.user.findUnique({
    where: { nostrPubkey: trimmedPubkey },
    select: { id: true },
  })
  if (existing && existing.id !== userId) {
    throw new SignInMethodError(
      "NOSTR_ALREADY_LINKED",
      "That Nostr key is already linked to another BitBudget account.",
      409,
    )
  }

  const data: { nostrPubkey: string; name?: string; image?: string } = { nostrPubkey: trimmedPubkey }
  const name = profileName?.trim()
  const image = profileImage?.trim()
  if (name) data.name = name
  if (image) data.image = image

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { nostrPubkey: true },
  })

  return { nostrPubkey: user.nostrPubkey, nostrLinked: Boolean(user.nostrPubkey) }
}
