import Link from "next/link"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

export default async function RefInvalidPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const sp = await searchParams
  const expired = sp.reason === "expired"

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
