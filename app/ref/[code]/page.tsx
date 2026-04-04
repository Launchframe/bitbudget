import { cookies } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"
import { incrementReferralVisit, validateReferralCodeRow } from "@/lib/referral"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

export default async function ReferralLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ method?: string }>
}) {
  const { code: rawCode } = await params
  const sp = await searchParams
  const method =
    typeof sp.method === "string" && sp.method.trim() ? sp.method.trim().slice(0, 32) : "link"

  let normalizedCode = rawCode
  try {
    normalizedCode = decodeURIComponent(rawCode)
  } catch {
    /* malformed % sequences — validate raw segment */
  }

  const v = await validateReferralCodeRow(normalizedCode)

  if (v.valid && v.type === "user") {
    void incrementReferralVisit(v.codeRow.id)
    const jar = await cookies()
    jar.set("bitbudget_ref", `${v.codeRow.code}:${method}`, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      httpOnly: false,
    })
    redirect("/auth")
  }

  const expired = v.valid === false && (v.reason === "expired" || v.reason === "exhausted")

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center p-6 text-center">
      <div className="mb-8">
        <BitbudgetLogo variant="btc" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">
        {expired ? "This referral code has expired" : "Invalid referral code"}
      </h1>
      <p className="text-muted-foreground text-sm max-w-md mb-8">
        Ask your friend for a fresh link or start without a code.
      </p>
      <Link
        href="/welcome"
        className="px-6 py-3 rounded-xl bg-[#F7931A] text-[#0D0D0D] font-semibold text-sm hover:bg-[#F7931A]/90"
      >
        Continue to BitBudget
      </Link>
    </div>
  )
}
