"use client"

import { useApp } from "@/lib/app-context"
import { DashboardMetrics } from "@/components/dashboard-metrics"
import { OpportunityCostChart } from "@/components/opportunity-cost-chart"
import { TopOpportunityCosts } from "@/components/top-opportunity-costs"
import { RecentTransactions } from "@/components/recent-transactions"
import { WalkthroughOverlay } from "@/components/walkthrough-overlay"
import { Skeleton } from "@/components/ui/skeleton"

function DashboardSkeleton({ ocEnabled }: { ocEnabled: boolean }) {
  const metricCount = ocEnabled ? 4 : 2
  return (
    <div className="flex flex-col gap-6" data-walkthrough="dashboard-area">
      <div className={`grid gap-4 ${ocEnabled ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
        {Array.from({ length: metricCount }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl bg-[#1A1A1A]" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl bg-[#1A1A1A]" />
      <div className="bg-[#0D0D0D] rounded-2xl overflow-hidden">
        <div className="px-4 md:px-6 pt-4 md:pt-6 pb-3">
          <Skeleton className="h-6 w-48 rounded-md bg-[#1A1A1A]" />
        </div>
        <div className="px-4 pb-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg bg-[#1A1A1A]" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { state, loading } = useApp()

  if (loading) {
    return <DashboardSkeleton ocEnabled={state.opportunityCostEnabled} />
  }

  return (
    <div className="flex flex-col gap-6" data-walkthrough="dashboard-area">
      <WalkthroughOverlay />
      <DashboardMetrics />
      <OpportunityCostChart />
      {state.opportunityCostEnabled ? <TopOpportunityCosts /> : <RecentTransactions />}
    </div>
  )
}
