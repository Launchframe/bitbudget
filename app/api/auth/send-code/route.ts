import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendVerificationCode } from "@/lib/email"

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const RATE_LIMIT_MS = 60_000
const CODE_TTL_MS = 10 * 60_000

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    /**
     * Playwright / CI: skip outbound email and use a fixed OTP from env.
     * Only applies when E2E_TEST is set and the address is under @bitbudget.test
     * (see e2e/). Never enable E2E_TEST in production deployments.
     */
    if (process.env.E2E_TEST === "true" && normalizedEmail.endsWith("@bitbudget.test")) {
      const e2eCode = process.env.E2E_EMAIL_CODE?.trim() ?? ""
      if (!/^[0-9]{6}$/.test(e2eCode)) {
        return NextResponse.json(
          { error: "E2E email login is misconfigured (need E2E_EMAIL_CODE=6 digits)" },
          { status: 500 },
        )
      }
      await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })
      await prisma.emailCode.create({
        data: {
          email: normalizedEmail,
          code: e2eCode,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      })
      return NextResponse.json({ sent: true })
    }

    const recent = await prisma.emailCode.findFirst({
      where: {
        email: normalizedEmail,
        createdAt: { gt: new Date(Date.now() - RATE_LIMIT_MS) },
      },
      orderBy: { createdAt: "desc" },
    })

    if (recent) {
      return NextResponse.json({ error: "Please wait before requesting another code" }, { status: 429 })
    }

    await prisma.emailCode.deleteMany({ where: { email: normalizedEmail } })

    const code = generateCode()
    await prisma.emailCode.create({
      data: {
        email: normalizedEmail,
        code,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    })

    await sendVerificationCode(normalizedEmail, code)

    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error("send-code error:", err)
    return NextResponse.json({ error: "Failed to send code" }, { status: 500 })
  }
}
