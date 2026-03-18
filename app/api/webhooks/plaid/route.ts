import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { plaidClient } from "@/lib/plaid"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { routeTransaction } from "@/lib/confidence-router"
import crypto from "crypto"

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const signatureHeader =
    req.headers.get("Plaid-Verification") ??
    req.headers.get("PLAID-WEBHOOK-SIGNATURE")

  const secret = process.env.PLAID_WEBHOOK_SECRET

  if (!signatureHeader || !secret) {
    return NextResponse.json(
      { error: "Invalid Plaid webhook: missing signature or secret" },
      { status: 400 },
    )
  }

  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")

  const received = Buffer.from(signatureHeader, "utf8")
  const expected = Buffer.from(expectedHmac, "utf8")

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    return NextResponse.json(
      { error: "Invalid Plaid webhook signature" },
      { status: 401 },
    )
  }

  const body = JSON.parse(rawBody) as {
    webhook_type?: string
    webhook_code?: string
    item_id?: string
  }
  const { webhook_type, webhook_code, item_id } = body

  if (webhook_type !== "TRANSACTIONS") {
    return NextResponse.json({ acknowledged: true })
  }

  if (webhook_code === "SYNC_UPDATES_AVAILABLE" && item_id) {
    const plaidItem = await prisma.plaidItem.findUnique({
      where: { plaidItemId: item_id },
      include: { user: { select: { id: true } } },
    })

    if (!plaidItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 })
    }

    try {
      const syncResponse = await plaidClient.transactionsSync({
        access_token: plaidItem.accessToken,
      })

      for (const txn of syncResponse.data.added) {
        const envelopeMatch = await matchEnvelope(
          plaidItem.user.id,
          txn.name || txn.merchant_name || "Unknown",
          txn.personal_finance_category?.primary,
        )

        await routeTransaction(plaidItem.user.id, {
          payee: txn.merchant_name || txn.name || "Unknown",
          amount: Math.abs(txn.amount),
          date: new Date(txn.date),
          source: "plaid",
          suggestedEnvelopeId: envelopeMatch?.envelopeId ?? null,
          confidence: envelopeMatch?.confidence ?? 0.3,
          rawInput: JSON.stringify({
            plaid_transaction_id: txn.transaction_id,
            category: txn.personal_finance_category,
          }),
        })
      }

      return NextResponse.json({ processed: syncResponse.data.added.length })
    } catch (err) {
      console.error("Plaid sync error:", err)
      return NextResponse.json(
        { error: "Sync failed" },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ acknowledged: true })
}
