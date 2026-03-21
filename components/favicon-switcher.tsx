"use client"

import { useEffect } from "react"
import { useApp } from "@/lib/app-context"

export function FaviconSwitcher() {
  const { state } = useApp()

  useEffect(() => {
    const href = state.opportunityCostEnabled ? "/icon.svg" : "/icon-vanilla.svg"
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    let created = false
    let previousHref: string | null = null

    if (!link) {
      link = document.createElement("link")
      link.rel = "icon"
      link.type = "image/svg+xml"
      document.head.appendChild(link)
      created = true
    } else {
      previousHref = link.href
    }

    link.href = href

    return () => {
      if (!link) return
      if (created) {
        if (link.parentNode === document.head) {
          document.head.removeChild(link)
        }
      } else if (previousHref !== null) {
        link.href = previousHref
      }
    }
  }, [state.opportunityCostEnabled])

  return null
}
