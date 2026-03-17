"use client"

import { useEffect } from "react"
import { useApp } from "@/lib/app-context"

export function FaviconSwitcher() {
  const { state } = useApp()

  useEffect(() => {
    const href = state.opportunityCostEnabled ? "/icon.svg" : "/icon-vanilla.svg"
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    if (!link) {
      link = document.createElement("link")
      link.rel = "icon"
      link.type = "image/svg+xml"
      document.head.appendChild(link)
    }
    link.href = href
  }, [state.opportunityCostEnabled])

  return null
}
