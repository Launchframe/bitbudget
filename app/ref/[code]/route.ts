import { NextResponse } from "next/server"
import { incrementReferralVisit, validateReferralCodeRow } from "@/lib/referral"

/**
 * Referral links must set `bitbudget_ref` in a Route Handler — Server Components cannot mutate cookies.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params
  const url = new URL(request.url)
  const rawMethod = url.searchParams.get("method")
  const method =
    typeof rawMethod === "string" && rawMethod.trim()
      ? rawMethod.trim().slice(0, 32)
      : "link"

  let normalizedCode = rawCode
  try {
    normalizedCode = decodeURIComponent(rawCode)
  } catch {
    /* malformed % sequences — validate raw segment */
  }

  const v = await validateReferralCodeRow(normalizedCode)

  if (v.valid && v.type === "user") {
    void incrementReferralVisit(v.codeRow.id)
    const res = NextResponse.redirect(new URL("/auth", request.url))
    res.cookies.set("bitbudget_ref", `${v.codeRow.code}:${method}`, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      httpOnly: false,
    })
    return res
  }

  const expired = v.valid === false && (v.reason === "expired" || v.reason === "exhausted")
  const invalidUrl = new URL("/ref/invalid", request.url)
  invalidUrl.searchParams.set("reason", expired ? "expired" : "invalid")
  return NextResponse.redirect(invalidUrl)
}
