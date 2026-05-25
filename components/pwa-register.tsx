"use client"

import { useEffect } from "react"

/** Registers the service worker for installable / offline shell use. */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV !== "production") return
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* optional — self-host and PWA are best-effort */
    })
  }, [])
  return null
}
