"use client"

import { useState, useEffect } from "react"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"

interface PremiumGateProps {
  feature: PremiumFeature
  children: React.ReactNode
}

export function PremiumGate({ feature, children }: PremiumGateProps) {
  const [tier, setTier] = useState<string | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    fetch("/api/user/settings")
      .then(r => r.json())
      .then(data => {
        const effective = (data as { effectiveTier?: string }).effectiveTier
        const subscription = (data as { subscriptionTier?: string }).subscriptionTier
        setTier(effective ?? subscription ?? "free")
      })
      .catch(() => setTier("free"))
  }, [])

  if (tier === null) return null

  if (tier === "free") {
    return (
      <>
        <div
          onClick={() => setShowUpgrade(true)}
          className="cursor-pointer"
        >
          {children}
        </div>
        <UpgradeModal
          key={showUpgrade ? feature : "hidden"}
          feature={feature}
          open={showUpgrade}
          onClose={() => setShowUpgrade(false)}
        />
      </>
    )
  }

  return <>{children}</>
}
