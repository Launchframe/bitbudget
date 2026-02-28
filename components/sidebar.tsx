"use client"

import { LayoutDashboard, BarChart3, Wallet, Search, Landmark, Plus, SquareArrowOutUpRight, Settings2, LogOut } from 'lucide-react'
import { useApp, type PageId } from "@/lib/app-context"

const navItems: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "DASHBOARD", icon: LayoutDashboard },
  { id: "analytics", label: "ANALYTICS", icon: BarChart3 },
  { id: "envelopes", label: "ENVELOPES", icon: Wallet },
  { id: "researcher", label: "RESEARCHER", icon: Search },
  { id: "funds", label: "FUNDS", icon: Landmark },
]

export function Sidebar() {
  const { currentPage, navigateTo, setTransactionDialogOpen } = useApp()

  return (
    <aside className="sticky top-24 h-[calc(100vh-8rem)] md:w-48 lg:w-64 bg-[#0D0D0D] rounded-2xl hidden md:flex flex-col p-8 overflow-y-auto">
      <nav className="flex flex-col gap-8">
        {navItems.map((item) => {
          const isActive = currentPage === item.id || (item.id === "envelopes" && currentPage === "envelope-detail")
          const isPlaceholder = item.id === "researcher" || item.id === "funds"
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => {
                if (!isPlaceholder) navigateTo(item.id)
              }}
              className={`flex items-center gap-4 transition-colors text-left ${
                isActive
                  ? "text-[#F7931A]"
                  : isPlaceholder
                    ? "text-[#444] cursor-not-allowed"
                    : "text-[#919191] hover:text-[#E7E7E7] cursor-pointer"
              }`}
              disabled={isPlaceholder}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-6 w-6" />
              <span className="text-sm font-medium tracking-wide">{item.label}</span>
              {isPlaceholder && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A1A] text-[#555] ml-auto">Soon</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* New Transaction CTA */}
      <button
        onClick={() => setTransactionDialogOpen(true)}
        className="mt-8 flex items-center gap-3 px-4 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors"
      >
        <Plus className="h-5 w-5" />
        <span>New Transaction</span>
      </button>

      <div className="mt-auto pt-8 border-t border-[#1F1F1F] flex flex-col gap-8">
        <button className="flex items-center gap-4 text-[#919191] hover:text-[#E7E7E7] transition-colors text-left">
          <SquareArrowOutUpRight className="h-6 w-6" />
          <span className="text-sm font-medium tracking-wide">SUPPORT</span>
        </button>
        <button className="flex items-center gap-4 text-[#919191] hover:text-[#E7E7E7] transition-colors text-left">
          <Settings2 className="h-6 w-6" />
          <span className="text-sm font-medium tracking-wide">SETTINGS</span>
        </button>
        <button className="flex items-center gap-4 text-[#919191] hover:text-[#E7E7E7] transition-colors text-left">
          <LogOut className="h-6 w-6" />
          <span className="text-sm font-medium tracking-wide">LOGOUT</span>
        </button>
      </div>
    </aside>
  )
}
