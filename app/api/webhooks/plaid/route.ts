import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { plaidClient } from "@/lib/plaid"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { routeTransaction } from "@/lib/confidence-router"
import crypto from "crypto"
import { activateReferral } from "@/lib/referral"
import { requirePremiumOrTrialOrReferralBankLinkPending } from "@/lib/subscription"
import { Prisma } from "@prisma/client"

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
    if (!(await requirePremiumOrTrialOrReferralBankLinkPending(plaidItem.user.id))) {
      return NextResponse.json({
        acknowledged: true,
        skipped: "premium_required",
      })
    }

    try {
      let cursor: string | undefined =
        plaidItem.transactionsSyncCursor ?? undefined
      let processed = 0

      for (;;) {
        const syncResponse = await plaidClient.transactionsSync({
          access_token: plaidItem.accessToken,
          cursor: cursor ?? undefined,
        })

        const { added, has_more, next_cursor } = syncResponse.data

        for (const txn of added) {
          let claimId: string
          try {
            const row = await prisma.plaidImportedTransaction.create({
              data: {
                userId: plaidItem.user.id,
                plaidTransactionId: txn.transaction_id,
              },
              select: { id: true },
            })
            claimId = row.id
          } catch (e) {
            if (
              e instanceof Prisma.PrismaClientKnownRequestError &&
              e.code === "P2002"
            ) {
              continue
            }
            throw e
          }

          try {
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
            processed++
          } catch (routeErr) {
            await prisma.plaidImportedTransaction.delete({
              where: { id: claimId },
            })
            throw routeErr
          }
        }

        cursor = next_cursor
        await prisma.plaidItem.update({
          where: { id: plaidItem.id },
          data: { transactionsSyncCursor: cursor },
        })

        if (!has_more) break
      }

      if (processed > 0) {
        await activateReferral(plaidItem.user.id)
      }

      return NextResponse.json({ processed })
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
