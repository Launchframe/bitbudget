import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { processRecurringTransactions } from "@/lib/recurring"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const created = await processRecurringTransactions(session.user.id)
  return NextResponse.json({ processed: created })
}
