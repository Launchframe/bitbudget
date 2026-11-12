import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  applyEmailUnsubscribe,
  parseUnsubscribeRequest,
  unsubscribeConfirmHtml,
} from "@/lib/unsubscribe"

async function readUnsubscribeInput(req: NextRequest): Promise<{
  token: string | null
  rawPreference: string | null
}> {
  if (req.method === "GET") {
    return {
      token: req.nextUrl.searchParams.get("token"),
      rawPreference:
        req.nextUrl.searchParams.get("preference") ?? req.nextUrl.searchParams.get("category"),
    }
  }

  const contentType = req.headers.get("content-type") ?? ""
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await req.formData()
    return {
      token: form.get("token")?.toString() ?? null,
      rawPreference:
        form.get("preference")?.toString() ?? form.get("category")?.toString() ?? null,
    }
  }

  try {
    const body = (await req.json()) as { token?: string; preference?: string; category?: string }
    return {
      token: typeof body.token === "string" ? body.token : null,
      rawPreference:
        typeof body.preference === "string"
          ? body.preference
          : typeof body.category === "string"
            ? body.category
            : null,
    }
  } catch {
    return { token: null, rawPreference: null }
  }
}

function invalidLinkResponse(req: NextRequest, status: number) {
  if (req.method === "GET") {
    return new NextResponse("Invalid unsubscribe link.", {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
  return NextResponse.json({ error: "Invalid unsubscribe link" }, { status })
}

export async function GET(req: NextRequest) {
  const { token, rawPreference } = await readUnsubscribeInput(req)
  const parsed = parseUnsubscribeRequest(token, rawPreference)
  if (!parsed) {
    return invalidLinkResponse(req, 400)
  }

  const user = await prisma.user.findUnique({
    where: { emailUnsubscribeToken: parsed.token },
    select: { id: true },
  })
  if (!user) {
    return invalidLinkResponse(req, 404)
  }

  const html = unsubscribeConfirmHtml(
    req.nextUrl.origin,
    parsed.token,
    rawPreference ?? "",
    parsed.label,
  )
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

export async function POST(req: NextRequest) {
  const { token, rawPreference } = await readUnsubscribeInput(req)
  const parsed = parseUnsubscribeRequest(token, rawPreference)
  if (!parsed) {
    return invalidLinkResponse(req, 400)
  }

  const applied = await applyEmailUnsubscribe(parsed.token, parsed.preference)
  if (!applied) {
    return invalidLinkResponse(req, 404)
  }

  return NextResponse.redirect(new URL("/auth?unsubscribed=1", req.nextUrl.origin), 303)
}
