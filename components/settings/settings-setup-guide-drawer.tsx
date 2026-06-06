"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  SettingsSetupGuideBody,
  SettingsSetupGuideCollapsedStrip,
  useSettingsSetupGuide,
} from "@/components/settings/settings-setup-guide-shared"

export function SettingsSetupGuideDrawer() {
  const [open, setOpen] = useState(false)
  const guide = useSettingsSetupGuide()
  const { remote, progress, nextTaskLabel, progressPct } = guide

  if (progress?.allComplete) return null

  return (
    <>
      <div
        className="tablet:hidden fixed left-0 right-0 z-40 bottom-16 pb-[env(safe-area-inset-bottom)]"
        data-walkthrough="settings-setup-guide-drawer"
      >
        <SettingsSetupGuideCollapsedStrip
          onOpen={() => setOpen(true)}
          progressPct={progressPct}
          nextTaskLabel={nextTaskLabel}
        />
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="tablet:hidden max-h-[min(85vh,720px)] rounded-t-2xl border-[#1F1F1F] bg-[#0D0D0D] px-0 pb-[env(safe-area-inset-bottom)] [&>button]:hidden"
          onInteractOutside={() => setOpen(false)}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1F1F1F] bg-[#0D0D0D] px-4 py-3">
            <SheetTitle className="text-base font-semibold text-foreground">Setup guide</SheetTitle>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A] transition-colors"
              aria-label="Close setup guide"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(min(85vh,720px)-3.5rem)] px-4 py-4">
            {!remote ? (
              <p className="text-sm text-muted-foreground py-4" role="status">
                Loading checklist…
              </p>
            ) : (
              <SettingsSetupGuideBody guide={guide} showHeader={false} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
