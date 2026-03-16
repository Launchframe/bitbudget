"use client"

import { DashboardMetrics } from "@/components/dashboard-metrics"
import { OpportunityCostChart } from "@/components/opportunity-cost-chart"
import { TopOpportunityCosts } from "@/components/top-opportunity-costs"
import { WalkthroughOverlay } from "@/components/walkthrough-overlay"

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6" data-walkthrough="dashboard-area">
      <WalkthroughOverlay />
      <DashboardMetrics />
      <OpportunityCostChart />
      <TopOpportunityCosts />
    </div>
  )
}
