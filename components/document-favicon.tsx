"use client"

import { useEffect } from "react"

/** Sets document favicon while mounted (vanilla vs Bitcoin icon for entry flows). */
export function DocumentFavicon({ href }: { href: string }) {
  useEffect(() => {
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
  }, [href])

  return null
}
