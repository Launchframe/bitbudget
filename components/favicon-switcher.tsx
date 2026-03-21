"use client"

import { useApp } from "@/lib/app-context"
import { useSyncDocumentFavicon } from "@/components/document-favicon"

export function FaviconSwitcher() {
  const { state } = useApp()
  const href = state.opportunityCostEnabled ? "/icon.svg" : "/icon-vanilla.svg"
  useSyncDocumentFavicon(href)
  return null
}
