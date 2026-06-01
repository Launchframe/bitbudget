"use client"

import { useEffect } from "react"
import { ensureServiceWorkerRegistered } from "@/lib/service-worker-registration"

/** Registers the service worker on first load so the app meets PWA install criteria. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    void ensureServiceWorkerRegistered()
  }, [])

  return null
}
