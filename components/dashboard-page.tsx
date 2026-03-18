"use client"

import { useApp } from "@/lib/app-context"
import { DashboardMetrics } from "@/components/dashboard-metrics"
import { OpportunityCostChart } from "@/components/opportunity-cost-chart"
import { TopOpportunityCosts } from "@/components/top-opportunity-costs"
import { RecentTransactions } from "@/components/recent-transactions"
import { WalkthroughOverlay } from "@/components/walkthrough-overlay"

export function DashboardPage() {
  const { state } = useApp()
  return (
    <div className="flex flex-col gap-6" data-walkthrough="dashboard-area">
      <WalkthroughOverlay />
      <DashboardMetrics />
      <OpportunityCostChart />
      {state.opportunityCostEnabled ? <TopOpportunityCosts /> : <RecentTransactions />}
    </div>
  )
}
