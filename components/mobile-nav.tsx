"use client"

import { Fragment } from "react"
import { LayoutDashboard, BarChart3, List, Wallet, Plus } from "lucide-react"
import { useApp, type PageId } from "@/lib/app-context"


const navItems: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Home", icon: LayoutDashboard },
  { id: "transactions", label: "Txns", icon: List },
  { id: "analytics", label: "Stats", icon: BarChart3 },
  { id: "envelopes", label: "Budget", icon: Wallet },
]

export function MobileNav() {
  const { currentPage, navigateTo, openNewTransaction } = useApp()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#0D0D0D] border-t border-[#1F1F1F] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around px-1 h-16">
        {navItems.map((item, i) => {
          const isActive = currentPage === item.id || (item.id === "envelopes" && (currentPage === "envelope-detail" || currentPage === "envelope-allocations"))
          const Icon = item.icon

          return (
            <Fragment key={item.id}>
              {i === 2 && (
                <button
                  onClick={() => openNewTransaction()}
                  className="flex items-center justify-center w-12 h-12 -mt-5 rounded-full bg-[#F7931A] text-[#0D0D0D] shadow-lg shadow-[#F7931A]/20"
                  aria-label="New transaction"
                >
                  <Plus className="h-6 w-6" />
                </button>
              )}
              <button
                onClick={() => navigateTo(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors ${
                  isActive ? "text-[#F7931A]" : "text-[#666] active:text-[#999]"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            </Fragment>
          )
        })}
      </div>
    </nav>
  )
}
