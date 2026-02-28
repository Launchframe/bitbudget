"use client"

import { DashboardMetrics } from "@/components/dashboard-metrics"
import { BtcPriceChart } from "@/components/btc-price-chart"
import { TopOpportunityCosts } from "@/components/top-opportunity-costs"

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardMetrics />
      <BtcPriceChart />
      <TopOpportunityCosts />
    </div>
  )
}
