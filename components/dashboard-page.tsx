"use client"

import { useApp } from "@/lib/app-context"
import { DashboardMetrics } from "@/components/dashboard-metrics"
import { OpportunityCostChart } from "@/components/opportunity-cost-chart"
import { TopOpportunityCosts } from "@/components/top-opportunity-costs"
import { RecentTransactions } from "@/components/recent-transactions"
import { SetupProgressCard } from "@/components/setup-progress-card"
import { YearEndRecapModal } from "@/components/year-end-recap-modal"
import { GoalHitCelebration } from "@/components/goal-hit-celebration"

export function DashboardPage() {
  const { state } = useApp()

  return (
    <div className="flex flex-col gap-6 min-w-0 w-full max-w-full">
      <SetupProgressCard />
      <YearEndRecapModal />
      <GoalHitCelebration />
      <div data-walkthrough="dashboard-metrics">
        <DashboardMetrics />
      </div>
      <div data-walkthrough="dashboard-chart">
        <OpportunityCostChart />
        {state.opportunityCostEnabled ? <TopOpportunityCosts /> : <RecentTransactions />}
      </div>
    </div>
  )
}
