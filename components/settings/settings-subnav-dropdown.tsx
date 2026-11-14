"use client"

import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SETTINGS_NAV_ITEMS,
  type SettingsTab,
  settingsTabButtonClass,
  settingsTabButtonStyle,
  settingsTabIconClass,
  settingsTabIconStyle,
} from "@/components/settings/settings-nav-config"
import { cn } from "@/lib/utils"

type Props = {
  activeTab: SettingsTab
  onSelectTab: (tab: SettingsTab) => void
  className?: string
}

export function SettingsSubnavDropdown({ activeTab, onSelectTab, className }: Props) {
  const activeItem = SETTINGS_NAV_ITEMS.find((i) => i.id === activeTab) ?? SETTINGS_NAV_ITEMS[0]
  const ActiveIcon = activeItem.icon

  return (
    <div className={cn("tablet:hidden min-w-0 w-full max-w-full", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-2 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50",
            )}
            aria-label="Settings section menu"
          >
            <span
              className={cn(
                settingsTabButtonClass(true, activeItem.savingsAccent),
                "justify-between",
              )}
              style={settingsTabButtonStyle(true, activeItem.savingsAccent)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <ActiveIcon
                  className={settingsTabIconClass(true, activeItem.savingsAccent)}
                  style={settingsTabIconStyle(true, activeItem.savingsAccent)}
                  aria-hidden
                />
                <span className="truncate">{activeItem.label}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-2 shadow-lg"
          sideOffset={4}
        >
          {SETTINGS_NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.id
            return (
              <DropdownMenuItem
                key={item.id}
                className="p-0 focus:bg-transparent cursor-pointer"
                onSelect={() => onSelectTab(item.id)}
              >
                <span
                  className={settingsTabButtonClass(active, item.savingsAccent)}
                  style={settingsTabButtonStyle(active, item.savingsAccent)}
                >
                  <Icon
                    className={settingsTabIconClass(active, item.savingsAccent)}
                    style={settingsTabIconStyle(active, item.savingsAccent)}
                    aria-hidden
                  />
                  <span>{item.label}</span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
