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
      .then(data => setTier(data.subscriptionTier || "free"))
      .catch(() => setTier("free"))
  }, [])

  if (tier === null) return null

  if (tier !== "premium") {
    return (
      <>
        <div
          onClick={() => setShowUpgrade(true)}
          className="cursor-pointer"
        >
          {children}
        </div>
        <UpgradeModal feature={feature} open={showUpgrade} onClose={() => setShowUpgrade(false)} />
      </>
    )
  }

  return <>{children}</>
}
