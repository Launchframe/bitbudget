import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { sendOpsAlertEmail } from "@/lib/email"
import { scrubAlertText } from "@/lib/sentry-scrub"

export type AlertSeverity = "info" | "warn" | "error" | "page"

export interface SendAlertInput {
  severity: AlertSeverity
  source: string
  title: string
  body: string
  fingerprint?: string
  traceUrl?: string
  runbookUrl?: string
  sentryEventId?: string
}

const DEDUP_WINDOW_MS = 15 * 60 * 1000

function skipOutboundAlerts(): boolean {
  return process.env.E2E_TEST === "true"
}

function sanitizeAlertInput(input: SendAlertInput): SendAlertInput {
  return {
    ...input,
    source: scrubAlertText(input.source),
    title: scrubAlertText(input.title),
    body: scrubAlertText(input.body),
    fingerprint: input.fingerprint ? scrubAlertText(input.fingerprint) : undefined,
    traceUrl: input.traceUrl ? scrubAlertText(input.traceUrl) : undefined,
    runbookUrl: input.runbookUrl ? scrubAlertText(input.runbookUrl) : undefined,
    sentryEventId: input.sentryEventId ? scrubAlertText(input.sentryEventId) : undefined,
  }
}

function formatAlertMessage(input: SendAlertInput): string {
  const lines = [
    `[${input.severity.toUpperCase()}] ${input.title}`,
    input.body,
    `Source: ${input.source}`,
  ]
  if (input.traceUrl) lines.push(`Trace: ${input.traceUrl}`)
  if (input.runbookUrl) lines.push(`Runbook: ${input.runbookUrl}`)
  return lines.join("\n")
}

async function sendDiscordAlert(message: string, severity: AlertSeverity): Promise<boolean> {
  const url = process.env.DISCORD_OPS_WEBHOOK_URL?.trim()
  if (!url) return false
  const prefix = severity === "page" ? "@here " : ""
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${prefix}${message.slice(0, 1900)}` }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function sendTelegramAlert(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_OPS_CHAT_ID?.trim()
  if (!token || !chatId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function sendEmailAlertToAdmins(subject: string, body: string): Promise<boolean> {
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { email: true },
  })
  const emails = admins.map(a => a.email?.trim()).filter(Boolean) as string[]
  if (emails.length === 0) return false

  let anySent = false
  for (const to of emails) {
    const sent = await sendOpsAlertEmail(to, subject, body)
    if (sent) anySent = true
  }
  return anySent
}

async function isDuplicate(fingerprint: string | undefined): Promise<boolean> {
  if (!fingerprint) return false
  const since = new Date(Date.now() - DEDUP_WINDOW_MS)
  const existing = await prisma.opsEvent.findFirst({
    where: { fingerprint, createdAt: { gte: since } },
    select: { id: true },
  })
  return Boolean(existing)
}

/** Multi-channel ops alert with dedup and DB persistence. */
export async function sendAlert(input: SendAlertInput): Promise<{ sent: boolean; eventId: string }> {
  const safeInput = sanitizeAlertInput(input)
  const message = formatAlertMessage(safeInput)
  const duplicate = await isDuplicate(safeInput.fingerprint)

  const channelStatus: Record<string, boolean> = {
    discord: false,
    telegram: false,
    email: false,
    skippedDuplicate: duplicate,
    skippedE2E: skipOutboundAlerts(),
  }

  if (!duplicate && !skipOutboundAlerts()) {
    channelStatus.discord = await sendDiscordAlert(message, input.severity)
    channelStatus.telegram = await sendTelegramAlert(message)
    channelStatus.email = await sendEmailAlertToAdmins(
      `[BitBudget ${input.severity}] ${safeInput.title}`,
      message.replace(/\n/g, "<br>"),
    )
  }

  const event = await prisma.opsEvent.create({
    data: {
      severity: safeInput.severity,
      source: safeInput.source,
      title: safeInput.title,
      body: safeInput.body,
      fingerprint: safeInput.fingerprint ?? null,
      sentryEventId: safeInput.sentryEventId ?? null,
      channelStatus: channelStatus as Prisma.InputJsonValue,
    },
  })

  const sent =
    !duplicate &&
    !skipOutboundAlerts() &&
    (channelStatus.discord || channelStatus.telegram || channelStatus.email)

  return { sent, eventId: event.id }
}
