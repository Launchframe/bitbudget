"use client"

import { useEffect } from "react"

/** Sets document favicon while mounted (vanilla vs Bitcoin icon for entry flows). */
export function DocumentFavicon({ href }: { href: string }) {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    if (!link) {
      link = document.createElement("link")
      link.rel = "icon"
      link.type = "image/svg+xml"
      document.head.appendChild(link)
    }
    link.href = href
  }, [href])

  return null
}
