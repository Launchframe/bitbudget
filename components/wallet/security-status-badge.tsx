"use client"

import { useEffect, useState } from "react"
import { ShieldCheck, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"

export type SecurityTier = "hardware" | "software" | "unknown"

export function detectSecurityTier(): Promise<SecurityTier> {
  if (typeof PublicKeyCredential === "undefined") return Promise.resolve("unknown")
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return Promise.resolve("software")
  }
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    .then((ok) => (ok ? "hardware" : "software"))
    .catch(() => "software" as SecurityTier)
}

interface SecurityStatusBadgeProps {
  tier?: SecurityTier
  onRiskClick?: () => void
  className?: string
  size?: "sm" | "md"
}

export function SecurityStatusBadge({
  tier,
  onRiskClick,
  className,
  size = "md",
}: SecurityStatusBadgeProps) {
  const [resolved, setResolved] = useState<SecurityTier>(tier ?? "unknown")

  useEffect(() => {
    if (tier !== undefined) {
      setTimeout(() => setResolved(tier), 0)
      return
    }
    void detectSecurityTier().then(setResolved)
  }, [tier])

  const isHardware = resolved === "hardware"
  const isUnknown = resolved === "unknown"

  const ringClass = isHardware
    ? "ring-[#22C55E]/40 text-[#22C55E]"
    : isUnknown
      ? "ring-white/10 text-muted-foreground"
      : "ring-[#F7931A]/40 text-[#F7931A]"

  const label = isHardware
    ? "Hardware-Backed"
    : isUnknown
      ? "Detecting…"
      : "Software-Protected"

  const Icon = isHardware || isUnknown ? ShieldCheck : ShieldAlert

  const smClass = size === "sm" ? "gap-1.5 px-2.5 py-1 text-xs" : "gap-2 px-3 py-1.5 text-sm"

  return (
    <div className={cn("inline-flex items-center", smClass, className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full ring-1 bg-black/20 backdrop-blur-sm font-medium",
          smClass,
          ringClass,
        )}
      >
        <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
        {label}
        {resolved === "software" && onRiskClick && (
          <button
            type="button"
            onClick={onRiskClick}
            className="ml-1 underline underline-offset-2 opacity-70 hover:opacity-100"
            aria-label="View risk disclosure"
          >
            ?
          </button>
        )}
      </span>
    </div>
  )
}
