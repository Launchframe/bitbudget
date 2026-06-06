"use client"

import {
  SettingsSetupGuideBody,
  useSettingsSetupGuide,
} from "@/components/settings/settings-setup-guide-shared"

/** Inline setup guide for tablet+ General tab; mobile uses SettingsSetupGuideDrawer. */
export function SettingsSetupGuideSection() {
  const guide = useSettingsSetupGuide()
  if (guide.progress?.allComplete) return null

  return (
    <div className="hidden tablet:block p-6 bg-[#0D0D0D] rounded-2xl min-w-0 w-full max-w-full tablet:col-span-2 lg:col-span-3 3xl:col-span-2">
      <SettingsSetupGuideBody guide={guide} />
    </div>
  )
}
