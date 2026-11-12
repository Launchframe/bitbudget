import { Crown } from "lucide-react"
import { PREMIUM_LOCKED_LABEL } from "@/lib/premium-ui-copy"
import { cn } from "@/lib/utils"

/** Compact Premium badge for disabled feature controls. */
export function PremiumLockedLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#F7931A]",
        className,
      )}
    >
      <Crown className="h-3 w-3 shrink-0" aria-hidden />
      {PREMIUM_LOCKED_LABEL}
    </span>
  )
}
