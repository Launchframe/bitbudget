"use client"

import type { ReactNode } from "react"
import { SettingsSubnavDropdown } from "@/components/settings/settings-subnav-dropdown"
import { SettingsSubnavSidebar } from "@/components/settings/settings-subnav-sidebar"
import type { SettingsTab } from "@/components/settings/settings-nav-config"
import { cn } from "@/lib/utils"

type Props = {
  activeTab: SettingsTab
  onSelectTab: (tab: SettingsTab) => void
  children: ReactNode
  /** Mobile-only dropdown at top of tab content (most tabs). */
  showMobileSubnav?: boolean
  className?: string
}

export function SettingsLayout({
  activeTab,
  onSelectTab,
  children,
  showMobileSubnav = true,
  className,
}: Props) {
  return (
    <div className={cn("flex min-w-0 w-full max-w-full gap-4 tablet:gap-6", className)}>
      <SettingsSubnavSidebar activeTab={activeTab} onSelectTab={onSelectTab} />
      <div
        className={cn(
          "flex min-w-0 w-full max-w-full flex-1 flex-col gap-6",
          "pb-36 tablet:pb-6",
        )}
      >
        {showMobileSubnav && (
          <SettingsSubnavDropdown activeTab={activeTab} onSelectTab={onSelectTab} />
        )}
        {children}
      </div>
    </div>
  )
}
