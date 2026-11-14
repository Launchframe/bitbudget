"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { AppProvider, useApp } from "@/lib/app-context"
import { BtcPriceProvider } from "@/lib/btc-price-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { NewTransactionDialog } from "@/components/new-transaction-dialog"
import { StatementImporterDialog } from "@/components/statement-importer-dialog"
import { DashboardPage } from "@/components/dashboard-page"
import { RunwayPage } from "@/components/runway-page"
import { AnalyticsPage } from "@/components/analytics-page"
import { EnvelopesPage } from "@/components/envelopes-page"
import { EnvelopeAllocationsPage } from "@/components/envelope-allocations-page"
import { EnvelopeDetailPage } from "@/components/envelope-detail-page"
import { TransactionsPage } from "@/components/transactions-page"
import { BtcPricePage } from "@/components/btc-price-page"
import { ReviewInbox } from "@/components/review-inbox"
import { ProfilePage } from "@/components/profile-page"
import { SettingsPage } from "@/components/settings-page"
import { ShoppingPage } from "@/components/shopping-page"
import { ShoppingGroupDetail } from "@/components/shopping-group-detail"
import { MobileNav } from "@/components/mobile-nav"
import { PinUnlockDialog } from "@/components/pin-unlock-dialog"
import { Spinner } from "@/components/ui/spinner"
import { FaviconSwitcher } from "@/components/favicon-switcher"
import { NotificationBanner } from "@/components/notification-banner"
import { TransactionLoadingIndicator } from "@/components/transaction-loading-indicator"
import { TrialWelcomeBanner } from "@/components/trial-welcome-banner"
import { ReferralPlaidReminderBanner } from "@/components/referral-plaid-reminder-banner"
import { ReferralRedeemFlashBanner } from "@/components/referral-redeem-flash-banner"
import { PremiumRenewalUiHost } from "@/components/premium-renewal-ui-host"
import { SurveySheetHost } from "@/components/survey-sheet"
import { WalkthroughOverlay } from "@/components/walkthrough-overlay"
import { AchievementCelebrationHost } from "@/components/achievement-celebration-host"

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [gateError, setGateError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function check() {
      setChecking(true)
      setGateError(null)
      try {
        const res = await fetch("/api/user/settings")
        if (cancelled) return
        if (res.status === 401 || res.status === 403) {
          signOut({ callbackUrl: "/auth" })
          return
        }
        if (!res.ok) {
          setGateError(
            "We could not load your account settings. This is usually a temporary server issue — not a sign-in problem.",
          )
          return
        }
        const data = await res.json()
        if (!data.onboardingComplete) {
          try {
            if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("onboardingSource") !== "btc") {
              sessionStorage.setItem("onboardingSource", "vanilla")
            }
          } catch {
            /* ignore */
          }
          router.replace("/onboarding")
          return
        }
      } catch {
        if (!cancelled) {
          setGateError("Could not reach the server. Check your connection and try again.")
        }
        return
      }
      if (!cancelled) setChecking(false)
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [router, retryCount])

  if (gateError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="max-w-md text-sm text-red-300" role="alert">
          {gateError}
        </p>
        <button
          type="button"
          onClick={() => setRetryCount(c => c + 1)}
          className="rounded-xl bg-[#F7931A] px-6 py-3 text-sm font-semibold text-[#0D0D0D] hover:bg-[#F7931A]/90"
        >
          Retry
        </button>
      </div>
    )
  }

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

/** Always wraps with BtcPriceProvider so toggling OC in Settings does not remount the app shell. */
function BtcPriceShell({ children }: { children: React.ReactNode }) {
  const { state } = useApp()
  return (
    <BtcPriceProvider enabled={state.opportunityCostEnabled}>
      {children}
    </BtcPriceProvider>
  )
}

function PageContent() {
  const { currentPage, txnLoadPhase } = useApp()

  // Main shell scrolls inside `app-main-scroll`, not `window` — reset on in-app navigation.
  useEffect(() => {
    document.getElementById("app-main-scroll")?.scrollTo({ top: 0, behavior: "auto" })
  }, [currentPage])

  if (txnLoadPhase === "init") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-8 w-8 text-[#F7931A]" />
      </div>
    )
  }

  switch (currentPage) {
    case "dashboard":
      return <DashboardPage />
    case "runway":
      return <RunwayPage />
    case "analytics":
      return <AnalyticsPage />
    case "transactions":
      return <TransactionsPage />
    case "btc-price":
      return <BtcPricePage />
    case "review-inbox":
      return <ReviewInbox />
    case "profile":
      return <ProfilePage />
    case "envelopes":
      return <EnvelopesPage />
    case "envelope-allocations":
      return <EnvelopeAllocationsPage />
    case "envelope-detail":
      return <EnvelopeDetailPage />
    case "settings":
      return <SettingsPage />
    case "shopping":
      return <ShoppingPage />
    case "shopping-group":
      return <ShoppingGroupDetail />
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

function StatementImporterHost() {
  const {
    statementImporterOpen,
    statementImporterPrefill,
    statementImporterKey,
    setStatementImporterOpen,
    activeTransactions,
    refreshData,
  } = useApp()
  return (
    <StatementImporterDialog
      key={statementImporterKey}
      open={statementImporterOpen}
      onOpenChange={setStatementImporterOpen}
      existingTransactions={activeTransactions}
      onImportComplete={refreshData}
      initialData={
        statementImporterPrefill?.transactions
          ? {
              transactions: statementImporterPrefill.transactions,
              meta: statementImporterPrefill.meta,
            }
          : null
      }
      pendingBatchId={statementImporterPrefill?.pendingBatchId ?? null}
    />
  )
}

export default function Dashboard() {
  return (
    <OnboardingGate>
      <AppProvider>
        <FaviconSwitcher />
        <EncryptionGate>
          <BtcPriceShell>
            <div className="relative h-screen w-full bg-background text-foreground overflow-hidden">
              <Header />
              <div id="app-main-scroll" className="h-full overflow-y-auto no-scrollbar">
                <main className="flex gap-4 md:gap-6 px-3 md:px-6 pb-20 md:pb-8 pt-20 md:pt-24 min-h-full">
                  <Sidebar />
                  <div className="flex-1 flex flex-col gap-4 md:gap-6 min-w-0">
                    <NotificationBanner />
                    <ReferralRedeemFlashBanner />
                    <ReferralPlaidReminderBanner />
                    <PremiumRenewalUiHost />
                    <TrialWelcomeBanner />
                    <TransactionLoadingIndicator />
                    <PageContent />
                  </div>
                </main>
              </div>
              <MobileNav />
              <WalkthroughOverlay />
              <AchievementCelebrationHost />
              <NewTransactionDialog />
              <StatementImporterHost />
              <SurveySheetHost />
            </div>
          </BtcPriceShell>
        </EncryptionGate>
      </AppProvider>
    </OnboardingGate>
  )
}
