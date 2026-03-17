import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseReceiptText } from "@/lib/receipt-parser"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { routeTransaction } from "@/lib/confidence-router"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const from = formData.get("from") as string // Forwarding user's email
    const text = formData.get("text") as string // Email body text
    const subject = formData.get("subject") as string

    if (!from || !text) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Look up user by email
    const senderEmail = extractEmail(from)
    const user = await prisma.user.findUnique({
      where: { email: senderEmail },
      select: { id: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Parse the receipt
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

    // Match envelope
    const amount = parseFloat(parsed.amount) || 0
    const date = parsed.date ? new Date(parsed.date) : new Date()
    const envelopeMatch = parsed.payee ? await matchEnvelope(user.id, parsed.payee) : null

    // Route through confidence system
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

    // Check if original sender is in approved senders list
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

function extractOriginalSender(text: string, subject: string): string | null {
  // Try to find "From:" in forwarded email headers
  const fromMatch = text.match(
    /(?:^|\n)From:\s*.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  )
  if (fromMatch) return fromMatch[1]
  // Check subject for "Fwd:" pattern
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

  // Check if sender is already approved
  const approved = await prisma.approvedReceiptSender.findFirst({
    where: {
      OR: [
        { senderPattern: senderAddress },
        ...(domainPattern ? [{ senderPattern: domainPattern }] : []),
      ],
    },
  })
  if (approved) return

  // Upsert pending sender review
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
