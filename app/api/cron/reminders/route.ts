import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { prisma } from "@/lib/db"

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({ skipped: true, reason: "VAPID not configured" })
  }

  webpush.setVapidDetails("mailto:support@bitbudget.com", vapidPublic, vapidPrivate)

  const now = new Date()
  const currentHour = now.getHours()

  const users = await prisma.user.findMany({
    where: {
      remindersEnabled: true,
      pushSubscriptions: { some: {} },
    },
    select: {
      id: true,
      reminderTime: true,
      pushSubscriptions: true,
      _count: {
        select: {
          transactions: {
            where: { createdAt: { gte: startOfToday() } },
          },
        },
      },
    },
  })

  let sent = 0
  for (const user of users) {
    if (user._count.transactions > 0) continue
    if (user.pushSubscriptions.length === 0) continue

    const reminderHour = user.reminderTime
      ? parseInt(user.reminderTime.split(":")[0] ?? "20", 10)
      : 20
    if (reminderHour !== currentHour) continue

    const payload = JSON.stringify({
      title: "bitbudget",
      body: "Log today's spending!",
      url: "/#/transactions",
    })

    for (const sub of user.pushSubscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        sent++
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "statusCode" in err &&
          (err as { statusCode: number }).statusCode === 410
        ) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } })
        }
      }
    }
  }

  return NextResponse.json({ sent })
}
