"use client"

import { useState } from "react"
import Link from "next/link"
import { LayoutDashboard, BarChart3, List, Wallet, Search, Landmark, Plus, ScanLine, SquareArrowOutUpRight, Settings2, LogOut, Bitcoin, Inbox, ShieldCheck } from "lucide-react"
import { useApp, type PageId } from "@/lib/app-context"
import { ScanReceiptDialog } from "@/components/scan-receipt-dialog"
import { VoiceDictationButton } from "@/components/voice-dictation-button"

const navItems: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "DASHBOARD", icon: LayoutDashboard },
  { id: "envelopes", label: "ENVELOPES", icon: Wallet },
  { id: "transactions", label: "TRANSACTIONS", icon: List },
  { id: "review-inbox", label: "REVIEW", icon: Inbox },
  { id: "analytics", label: "ANALYTICS", icon: BarChart3 },
  { id: "btc-price", label: "BTC", icon: Bitcoin },
  { id: "researcher", label: "RESEARCHER", icon: Search },
  { id: "funds", label: "FUNDS", icon: Landmark },
]

export function Sidebar() {
  const { currentPage, navigateTo, openNewTransaction, logout, state, pendingCount, isAdmin } = useApp()
  const [scanOpen, setScanOpen] = useState(false)

  return (
    <aside className="sticky top-24 h-[calc(100vh-8rem)] w-16 lg:w-64 bg-[#0D0D0D] rounded-2xl hidden md:flex flex-col py-8 px-3 lg:px-8 overflow-y-auto">
      <nav className="flex flex-col gap-8">
        {navItems.filter(item => item.id !== "btc-price" || state.opportunityCostEnabled).map((item) => {
          const isActive = currentPage === item.id || (item.id === "envelopes" && currentPage === "envelope-detail")
          const isPlaceholder = item.id === "researcher" || item.id === "funds"
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => {
                if (!isPlaceholder) navigateTo(item.id)
              }}
              title={item.label}
              {...(item.id === "transactions" ? { "data-walkthrough": "transactions" } : {})}
              className={`relative flex items-center justify-center lg:justify-start gap-4 transition-colors text-left ${
                isActive
                  ? "text-[#F7931A]"
                  : isPlaceholder
                    ? "text-[#444] cursor-not-allowed"
                    : "text-[#919191] hover:text-[#E7E7E7] cursor-pointer"
              }`}
              disabled={isPlaceholder}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-6 w-6 shrink-0" />
              <span className="hidden lg:inline text-sm font-medium tracking-wide">{item.label}</span>
              {item.id === "review-inbox" && pendingCount > 0 && (
                <span className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded-full bg-[#F7931A] text-[#0D0D0D] font-bold ml-auto">
                  {pendingCount}
                </span>
              )}
              {item.id === "review-inbox" && pendingCount > 0 && (
                <span className="lg:hidden absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#F7931A]" />
              )}
              {isPlaceholder && (
                <span className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A1A] text-[#555] ml-auto">Soon</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mt-8 flex flex-col gap-2">
        <button
          onClick={() => openNewTransaction()}
          title="New Transaction"
          data-walkthrough="new-transaction"
          className="flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-4 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors"
        >
          <Plus className="h-5 w-5 shrink-0" />
          <span className="hidden lg:inline">New Transaction</span>
        </button>
        <button
          onClick={() => setScanOpen(true)}
          title="Scan Receipt"
          className="flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-2.5 py-2.5 bg-[#1A1A1A] text-foreground rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333]"
        >
          <ScanLine className="h-4 w-4 text-[#F7931A] shrink-0" />
          <span className="hidden lg:inline">Scan Receipt</span>
        </button>
        <VoiceDictationButton />
      </div>

      <ScanReceiptDialog open={scanOpen} onOpenChange={setScanOpen} />

      <div className="mt-auto pt-8 border-t border-[#1F1F1F] flex flex-col gap-8">
        {isAdmin && (
          <Link
            href="/admin"
            title="Admin"
            className="flex items-center justify-center lg:justify-start gap-4 text-[#919191] hover:text-[#E7E7E7] transition-colors text-left"
          >
            <ShieldCheck className="h-6 w-6 shrink-0" />
            <span className="hidden lg:inline text-sm font-medium tracking-wide">ADMIN</span>
          </Link>
        )}
        <button title="Support" className="flex items-center justify-center lg:justify-start gap-4 text-[#919191] hover:text-[#E7E7E7] transition-colors text-left">
          <SquareArrowOutUpRight className="h-6 w-6 shrink-0" />
          <span className="hidden lg:inline text-sm font-medium tracking-wide">SUPPORT</span>
        </button>
        <button
          onClick={() => navigateTo("settings")}
          title="Settings"
          className={`flex items-center justify-center lg:justify-start gap-4 transition-colors text-left ${
            currentPage === "settings" ? "text-[#F7931A]" : "text-[#919191] hover:text-[#E7E7E7]"
          }`}
        >
          <Settings2 className="h-6 w-6 shrink-0" />
          <span className="hidden lg:inline text-sm font-medium tracking-wide">SETTINGS</span>
        </button>
        <button
          onClick={logout}
          title="Logout"
          className="flex items-center justify-center lg:justify-start gap-4 text-[#919191] hover:text-[#E7E7E7] transition-colors text-left"
        >
          <LogOut className="h-6 w-6 shrink-0" />
          <span className="hidden lg:inline text-sm font-medium tracking-wide">LOGOUT</span>
        </button>
      </div>
    </aside>
  )
}
