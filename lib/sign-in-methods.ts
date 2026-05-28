import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  NOSTR_AUTH_EVENT_CONTENT,
  NOSTR_AUTH_EVENT_KIND,
  NOSTR_AUTH_EVENT_METHOD,
} from "@/lib/nostr-auth-event"
import { sanitizeNostrProfileImage, sanitizeNostrProfileName } from "@/lib/nostr-profile"

export type LinkProvider = "google" | "github"
const NOSTR_AUTH_EVENT_MAX_AGE_SECONDS = 5 * 60
const NOSTR_AUTH_EVENT_FUTURE_SKEW_SECONDS = 60

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
  expectedOrigin?: string
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

function isUniqueConstraintError(error: unknown, field: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false
  }
  const target = error.meta?.target
  return Array.isArray(target) ? target.includes(field) : target === field
}

function hasTag(event: { tags: string[][] }, name: string, value: string) {
  return event.tags.some(tag => tag[0] === name && tag[1] === value)
}

function parseNostrAuthEvent(event: string, pubkey: string, expectedOrigin?: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(event)
  } catch {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }

  const candidate = parsed as {
    kind?: unknown
    content?: unknown
    created_at?: unknown
    pubkey?: unknown
    tags?: unknown
  }
  if (
    candidate.kind !== NOSTR_AUTH_EVENT_KIND ||
    candidate.content !== NOSTR_AUTH_EVENT_CONTENT ||
    typeof candidate.pubkey !== "string" ||
    candidate.pubkey.toLowerCase() !== pubkey ||
    typeof candidate.created_at !== "number" ||
    !Array.isArray(candidate.tags)
  ) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }

  const tags = candidate.tags
  if (!tags.every(tag => Array.isArray(tag) && tag.every(part => typeof part === "string"))) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }

  const authEvent = {
    ...candidate,
    created_at: candidate.created_at,
    tags: tags as string[][],
  }
  const now = Math.floor(Date.now() / 1000)
  if (
    authEvent.created_at < now - NOSTR_AUTH_EVENT_MAX_AGE_SECONDS ||
    authEvent.created_at > now + NOSTR_AUTH_EVENT_FUTURE_SKEW_SECONDS
  ) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Nostr sign-in request expired")
  }
  if (!hasTag(authEvent, "method", NOSTR_AUTH_EVENT_METHOD)) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }
  if (expectedOrigin && !hasTag(authEvent, "u", expectedOrigin)) {
    throw new SignInMethodError("INVALID_NOSTR_EVENT", "Invalid signed Nostr event")
  }

  return authEvent as Parameters<(typeof import("nostr-tools"))["verifyEvent"]>[0]
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

  const oauthProviders = Array.from(
    new Set(
      user.accounts
        .map(account => account.provider)
        .filter((provider): provider is LinkProvider => provider === "google" || provider === "github"),
    ),
  )

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

  let user: { email: string | null }
  try {
    user = await prisma.user.update({
      where: { id: userId },
      data: { email: normalizedEmail, emailVerified: new Date() },
      select: { email: true },
    })
  } catch (error) {
    if (isUniqueConstraintError(error, "email")) {
      throw new SignInMethodError(
        "EMAIL_ALREADY_LINKED",
        "That email is already linked to another BitBudget account.",
        409,
      )
    }
    throw error
  }
  await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })

  return { email: user.email, emailLinked: Boolean(user.email) }
}

export async function linkNostrSignInMethod({
  userId,
  pubkey,
  event,
  expectedOrigin,
  profileName,
  profileImage,
}: LinkNostrInput) {
  const trimmedPubkey = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(trimmedPubkey)) {
    throw new SignInMethodError("INVALID_NOSTR_PUBKEY", "Invalid Nostr public key")
  }

  let parsedEvent: Parameters<(typeof import("nostr-tools"))["verifyEvent"]>[0]
  try {
    parsedEvent = parseNostrAuthEvent(event, trimmedPubkey, expectedOrigin)
    const { verifyEvent } = await import("nostr-tools")
    if (!verifyEvent(parsedEvent)) {
      throw new SignInMethodError("INVALID_NOSTR_EVENT", "Nostr signature could not be verified")
    }
  } catch (error) {
    if (error instanceof SignInMethodError) {
      throw error
    }
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
  const name = sanitizeNostrProfileName(profileName)
  const image = sanitizeNostrProfileImage(profileImage)
  if (name) data.name = name
  if (image) data.image = image

  let user: { nostrPubkey: string | null }
  try {
    user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { nostrPubkey: true },
    })
  } catch (error) {
    if (isUniqueConstraintError(error, "nostrPubkey")) {
      throw new SignInMethodError(
        "NOSTR_ALREADY_LINKED",
        "That Nostr key is already linked to another BitBudget account.",
        409,
      )
    }
    throw error
  }

  return { nostrPubkey: user.nostrPubkey, nostrLinked: Boolean(user.nostrPubkey) }
}
