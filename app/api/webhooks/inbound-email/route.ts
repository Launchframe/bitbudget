import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseReceiptText } from "@/lib/receipt-parser"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { routeTransaction } from "@/lib/confidence-router"
import {
  getSendGridInboundHeaders,
  isSendGridWebhookTimestampFresh,
  parseMultipartFormFields,
  verifySendGridInboundWebhook,
} from "@/lib/sendgrid-inbound-verify"

const publicKeyEnv = process.env.SENDGRID_INBOUND_WEBHOOK_PUBLIC_KEY

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data" },
        { status: 400 },
      )
    }

    const rawBody = Buffer.from(await req.arrayBuffer())

    if (publicKeyEnv?.trim()) {
      const { signature, timestamp } = getSendGridInboundHeaders(req)
      if (!signature || !timestamp) {
        return NextResponse.json(
          { error: "Missing SendGrid webhook signature headers" },
          { status: 401 },
        )
      }
      if (!isSendGridWebhookTimestampFresh(timestamp)) {
        return NextResponse.json(
          { error: "Invalid or expired webhook timestamp" },
          { status: 401 },
        )
      }
      if (
        !verifySendGridInboundWebhook(
          publicKeyEnv.trim(),
          timestamp,
          rawBody,
          signature,
        )
      ) {
        return NextResponse.json(
          { error: "Invalid webhook signature" },
          { status: 401 },
        )
      }
    } else if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error:
            "Inbound email signing not configured. Set SENDGRID_INBOUND_WEBHOOK_PUBLIC_KEY and enable a SendGrid Inbound Parse security policy.",
        },
        { status: 503 },
      )
    } else {
      console.warn(
        "[inbound-email] SENDGRID_INBOUND_WEBHOOK_PUBLIC_KEY not set; signature verification skipped (development only)",
      )
    }

    let fields: Record<string, string>
    try {
      fields = await parseMultipartFormFields(rawBody, contentType)
    } catch (e) {
      console.error("inbound-email multipart parse:", e)
      return NextResponse.json(
        { error: "Could not parse multipart body" },
        { status: 400 },
      )
    }

    const from = fields.from
    const to = fields.to ?? fields.recipient ?? ""
    const text = fields.text
    const subject = fields.subject ?? ""

    if (!from || !text) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const recipientMatch = extractReceiptInboxToken(to)
    const senderEmail = extractEmail(from)
    const user = recipientMatch
      ? await prisma.user.findUnique({
          where: { receiptInboxToken: recipientMatch },
          select: { id: true, email: true },
        })
      : await prisma.user.findFirst({
          where: { email: senderEmail },
          select: { id: true, email: true },
        })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    let parsed
    try {
      parsed = await parseReceiptText(text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("429") || message.includes("rate limit")) {
        return NextResponse.json(
          { error: "Receipt parsing is temporarily rate-limited. Try again in a minute." },
          { status: 503, headers: { "Retry-After": "60" } },
        )
      }
      return NextResponse.json(
        { error: "Could not parse receipt. " + message },
        { status: 422 },
      )
    }

    if (!parsed.payee && !parsed.amount) {
      return NextResponse.json({ error: "No transaction data found" }, { status: 422 })
    }

    const amount = parseFloat(parsed.amount) || 0
    if (!(amount > 0) || !parsed.payee?.trim()) {
      return NextResponse.json(
        { error: "Valid payee and positive amount required" },
        { status: 422 },
      )
    }

    const date = parsed.date ? new Date(parsed.date) : new Date()
    const envelopeMatch = parsed.payee ? await matchEnvelope(user.id, parsed.payee) : null

    const confidence = envelopeMatch?.confidence ?? 0.3
    const result = await routeTransaction(user.id, {
      payee: parsed.payee || "Unknown",
      amount,
      date,
      source: "email_forward",
      suggestedEnvelopeId: envelopeMatch?.envelopeId ?? null,
      confidence,
      rawInput: `Subject: ${subject}\n\n${text.slice(0, 500)}`,
    })

    const originalSender = extractOriginalSender(text, subject) || senderEmail
    await checkAndQueueSender(originalSender, parsed.payee, amount)

    return NextResponse.json({ success: true, route: result.route, id: result.id })
  } catch (err) {
    console.error("inbound email error:", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

function extractEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/)
  return match ? match[1] : fromHeader.trim()
}

function extractReceiptInboxToken(toHeader: string): string | null {
  const match = toHeader.match(/receipts\+([a-f0-9]{32})@parse\.bitbudget\.io/i)
  return match ? match[1].toLowerCase() : null
}

function extractOriginalSender(text: string, subject: string): string | null {
  const fromMatch = text.match(
    /(?:^|\n)From:\s*.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  )
  if (fromMatch) return fromMatch[1]
  if (subject?.toLowerCase().startsWith("fwd:")) return null
  return null
}

async function checkAndQueueSender(
  senderAddress: string,
  samplePayee: string | null,
  sampleAmount: number,
): Promise<void> {
  const domain = senderAddress.split("@")[1]
  const domainPattern = domain ? `*@${domain}` : null

  const approved = await prisma.approvedReceiptSender.findFirst({
    where: {
      OR: [
        { senderPattern: senderAddress },
        ...(domainPattern ? [{ senderPattern: domainPattern }] : []),
      ],
    },
  })
  if (approved) return

  const existing = await prisma.pendingSenderReview.findFirst({
    where: { senderAddress, status: "pending" },
  })

  if (existing) {
    await prisma.pendingSenderReview.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
    })
  } else {
    await prisma.pendingSenderReview.create({
      data: {
        senderAddress,
        samplePayee: samplePayee || null,
        sampleAmount: sampleAmount || null,
      },
    })
  }
}
