import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/**
 * Deletes a test user by email. Only @bitbudget.test addresses when E2E_TEST is set.
 */
export async function POST(req: NextRequest) {
  if (process.env.E2E_TEST !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: { email?: string }
  try {
    body = (await req.json()) as { email?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !email.endsWith("@bitbudget.test")) {
    return NextResponse.json({ error: "email must end with @bitbudget.test" }, { status: 400 })
  }

  await prisma.user.deleteMany({ where: { email } })

  return NextResponse.json({ ok: true, email })
}
