/**
 * Legacy route — redirects to /api/payee-rules.
 * Kept for backward compatibility with any cached references; remove in a future cleanup PR.
 */
import { NextRequest, NextResponse } from "next/server"

function redirectToRules(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = url.pathname.replace("/api/payee-aliases", "/api/payee-rules")
  return NextResponse.redirect(url, { status: 308 })
}

export function GET(req: NextRequest) {
  return redirectToRules(req)
}

export function POST(req: NextRequest) {
  return redirectToRules(req)
}

export function DELETE(req: NextRequest) {
  return redirectToRules(req)
}
