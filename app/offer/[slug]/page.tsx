import Link from "next/link"
import { notFound } from "next/navigation"
import { validateReferralCodeRow } from "@/lib/referral"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

/** Cookie is set in `app/[slug]/route.ts` (Route Handler); this page is the post-redirect UI only. */
export default async function OfferLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const v = await validateReferralCodeRow(slug)

  if (!v.valid || v.type !== "offer") {
    notFound()
  }

  const headline = v.codeRow.label?.trim() || "You have an exclusive offer"

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center p-6 text-center">
      <div className="mb-8">
        <BitbudgetLogo variant="btc" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">{headline}</h1>
      <p className="text-muted-foreground text-sm max-w-md mb-8">
        Create your account to start with premium trial benefits.
      </p>
      <Link
        href="/auth"
        className="px-6 py-3 rounded-xl bg-[#F7931A] text-[#0D0D0D] font-semibold text-sm hover:bg-[#F7931A]/90"
      >
        Continue to sign in
      </Link>
    </div>
  )
}
