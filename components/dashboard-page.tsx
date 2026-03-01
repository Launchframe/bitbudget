"use client"

import { DashboardMetrics } from "@/components/dashboard-metrics"
import { OpportunityCostChart } from "@/components/opportunity-cost-chart"
import { TopOpportunityCosts } from "@/components/top-opportunity-costs"

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardMetrics />
      <OpportunityCostChart />
      <TopOpportunityCosts />
    </div>
  )
}
