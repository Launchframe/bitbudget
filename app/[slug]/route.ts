import { NextResponse } from "next/server"
import { incrementReferralVisit, validateReferralCodeRow } from "@/lib/referral"

/**
 * Public offer slugs live at `/[slug]` (single segment, not reserved). Cookie mutation must happen
 * in a Route Handler — not a Server Component — then redirect to `/offer/[slug]` for UI.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const v = await validateReferralCodeRow(slug)

  if (!v.valid || v.type !== "offer") {
    const invalidUrl = new URL("/ref/invalid", request.url)
    invalidUrl.searchParams.set("reason", "invalid")
    return NextResponse.redirect(invalidUrl)
  }

  void incrementReferralVisit(v.codeRow.id)
  const dest = new URL(`/offer/${encodeURIComponent(v.codeRow.code)}`, request.url)
  const res = NextResponse.redirect(dest)
  res.cookies.set("bitbudget_ref", `${v.codeRow.code}:link`, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: false,
  })
  return res
}
