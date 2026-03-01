"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AppProvider, useApp } from "@/lib/app-context"
import { BtcPriceProvider } from "@/lib/btc-price-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { NewTransactionDialog } from "@/components/new-transaction-dialog"
import { DashboardPage } from "@/components/dashboard-page"
import { AnalyticsPage } from "@/components/analytics-page"
import { EnvelopesPage } from "@/components/envelopes-page"
import { EnvelopeDetailPage } from "@/components/envelope-detail-page"
import { TransactionsPage } from "@/components/transactions-page"
import { BtcPricePage } from "@/components/btc-price-page"
import { SettingsPage } from "@/components/settings-page"
import { MobileNav } from "@/components/mobile-nav"
import { PinUnlockDialog } from "@/components/pin-unlock-dialog"
import { Spinner } from "@/components/ui/spinner"

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/user/settings")
        if (res.status === 401 || res.status === 403) {
          router.replace("/auth")
          return
        }
        if (res.ok) {
          const data = await res.json()
          if (!data.onboardingComplete) {
            router.replace("/onboarding")
            return
          }
        } else {
          router.replace("/auth")
          return
        }
      } catch {
        router.replace("/auth")
        return
      }
      setChecking(false)
    }
    check()
  }, [router])

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Spinner className="h-8 w-8 text-[#F7931A]" />
      </div>
    )
  }

  return <>{children}</>
}

function EncryptionGate({ children }: { children: React.ReactNode }) {
  const { encryption, unlockWithKey, logout } = useApp()

  if (encryption.needsPinUnlock && encryption.encryptedPrivacyKey && encryption.privacyKeySalt) {
    return (
      <PinUnlockDialog
        encryptedPrivacyKey={encryption.encryptedPrivacyKey}
        privacyKeySalt={encryption.privacyKeySalt}
        onUnlock={unlockWithKey}
        onLogout={logout}
      />
    )
  }

  return <>{children}</>
}

function PageContent() {
  const { currentPage, loading } = useApp()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-8 w-8 text-[#F7931A]" />
      </div>
    )
  }

  switch (currentPage) {
    case "dashboard":
      return <DashboardPage />
    case "analytics":
      return <AnalyticsPage />
    case "transactions":
      return <TransactionsPage />
    case "btc-price":
      return <BtcPricePage />
    case "envelopes":
      return <EnvelopesPage />
    case "envelope-detail":
      return <EnvelopeDetailPage />
    case "settings":
      return <SettingsPage />
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
    <OnboardingGate>
      <AppProvider>
        <EncryptionGate>
          <BtcPriceProvider>
          <div className="relative h-screen w-full bg-background text-foreground overflow-hidden">
            <Header />
            <div className="h-full overflow-y-auto no-scrollbar">
              <main className="flex gap-4 md:gap-6 px-3 md:px-6 pb-20 md:pb-8 pt-20 md:pt-24 min-h-full">
                <Sidebar />
                <div className="flex-1 flex flex-col gap-4 md:gap-6 min-w-0">
                  <PageContent />
                </div>
              </main>
            </div>
            <MobileNav />
            <NewTransactionDialog />
          </div>
          </BtcPriceProvider>
        </EncryptionGate>
      </AppProvider>
    </OnboardingGate>
  )
}
