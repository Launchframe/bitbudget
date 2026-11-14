"use client"

import { useCallback, useRef, useState } from "react"
import { PanelLeftOpen, PanelLeftClose } from "lucide-react"
import {
  SETTINGS_NAV_ITEMS,
  type SettingsTab,
  settingsTabButtonClass,
  settingsTabButtonStyle,
  settingsTabIconClass,
  settingsTabIconStyle,
} from "@/components/settings/settings-nav-config"
import { cn } from "@/lib/utils"

const COLLAPSED_WIDTH = "3.5rem"
const EXPANDED_WIDTH = "13.75rem"

type Props = {
  activeTab: SettingsTab
  onSelectTab: (tab: SettingsTab) => void
}

export function SettingsSubnavSidebar({ activeTab, onSelectTab }: Props) {
  const [expanded, setExpanded] = useState(false)
  const railRef = useRef<HTMLElement>(null)

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => !v)
  }, [])

  const handleRailBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!expanded) return
      if (e.target === e.currentTarget) setExpanded(false)
    },
    [expanded],
  )

  const handleEmptyAreaClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) toggleExpanded()
    },
    [toggleExpanded],
  )

  return (
    <div className="hidden tablet:block relative shrink-0" style={{ width: COLLAPSED_WIDTH }}>
      <aside
        ref={railRef}
        className={cn(
          "sticky top-6 z-40 flex flex-col rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D]",
          expanded ? "absolute left-0 shadow-xl shadow-black/50" : "relative",
        )}
        style={{
          width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
          minHeight: expanded ? undefined : "12rem",
        }}
        onClick={handleRailBackgroundClick}
        aria-label="Settings sections"
      >
        <div
          className={cn(
            "flex flex-1 flex-col gap-1 p-2 min-h-[10rem]",
            !expanded && "cursor-pointer",
          )}
          onClick={!expanded ? handleEmptyAreaClick : undefined}
          role={!expanded ? "button" : undefined}
          tabIndex={!expanded ? 0 : undefined}
          onKeyDown={
            !expanded
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    toggleExpanded()
                  }
                }
              : undefined
          }
          aria-label={!expanded ? "Expand settings menu" : undefined}
        >
          {SETTINGS_NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectTab(item.id)
                  setExpanded(false)
                }}
                className={cn(
                  settingsTabButtonClass(active, item.savingsAccent),
                  expanded ? "px-3" : "justify-center px-2",
                )}
                style={settingsTabButtonStyle(active, item.savingsAccent)}
                title={!expanded ? item.label : undefined}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className={settingsTabIconClass(active, item.savingsAccent)}
                  style={settingsTabIconStyle(active, item.savingsAccent)}
                  aria-hidden
                />
                {expanded && <span className="truncate">{item.label}</span>}
              </button>
            )
          })}
        </div>

        <div className="border-t border-[#1F1F1F] p-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleExpanded()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-[#111111] transition-colors"
            aria-label={expanded ? "Collapse settings menu" : "Expand settings menu"}
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate text-xs">Collapse</span>
              </>
            ) : (
              <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </button>
        </div>
      </aside>
    </div>
  )
}
