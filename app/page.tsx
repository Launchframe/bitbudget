"use client"

import { AppProvider, useApp } from "@/lib/app-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { NewTransactionDialog } from "@/components/new-transaction-dialog"
import { DashboardPage } from "@/components/dashboard-page"
import { AnalyticsPage } from "@/components/analytics-page"
import { EnvelopesPage } from "@/components/envelopes-page"
import { EnvelopeDetailPage } from "@/components/envelope-detail-page"

function PageContent() {
  const { currentPage } = useApp()

  switch (currentPage) {
    case "dashboard":
      return <DashboardPage />
    case "analytics":
      return <AnalyticsPage />
    case "envelopes":
      return <EnvelopesPage />
    case "envelope-detail":
      return <EnvelopeDetailPage />
    case "researcher":
    case "funds":
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-20 bg-[#0D0D0D] rounded-2xl">
          <div className="p-4 rounded-full bg-[#F7931A]/10">
            <svg className="h-6 w-6 text-[#F7931A]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
            </svg>
          </div>
          <p className="text-foreground font-semibold text-lg">Coming Soon</p>
          <p className="text-muted-foreground text-sm">This feature is under development.</p>
        </div>
      )
    default:
      return <DashboardPage />
  }
}

export default function Dashboard() {
  return (
    <AppProvider>
      <div className="relative h-screen w-full bg-background text-foreground overflow-hidden">
        <Header />
        <div className="h-full overflow-y-auto no-scrollbar">
          <main className="flex gap-6 p-6 pt-24 min-h-full">
            <Sidebar />
            <div className="flex-1 flex flex-col gap-6 min-w-0 pb-8">
              <PageContent />
            </div>
          </main>
        </div>
        <NewTransactionDialog />
      </div>
    </AppProvider>
  )
}
