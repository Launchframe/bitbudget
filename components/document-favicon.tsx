"use client"

import { useEffect } from "react"

/** Swap `<link rel="icon">` href; returns cleanup to restore or remove the node. */
function attachDocumentFavicon(href: string): () => void {
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
}

/** Keeps document favicon in sync with `href` while mounted. */
export function useSyncDocumentFavicon(href: string) {
  useEffect(() => attachDocumentFavicon(href), [href])
}

/** Sets document favicon while mounted (vanilla vs Bitcoin icon for entry flows). */
export function DocumentFavicon({ href }: { href: string }) {
  useSyncDocumentFavicon(href)
  return null
}
