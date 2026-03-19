"use client"

import * as React from "react"

export type PlatformOS =
  | "android"
  | "ios"
  | "macos"
  | "windows"
  | "linux"
  | "unknown"

export type PlatformBrowser =
  | "chrome"
  | "firefox"
  | "safari"
  | "edge"
  | "other"

export interface PlatformInfo {
  os: PlatformOS
  browser: PlatformBrowser
  isMobileDevice: boolean
}

const defaultPlatform: PlatformInfo = {
  os: "unknown",
  browser: "other",
  isMobileDevice: false,
}

function parsePlatform(): PlatformInfo {
  if (typeof navigator === "undefined") return defaultPlatform
  const ua = navigator.userAgent
  const uaLower = ua.toLowerCase()

  let os: PlatformOS = "unknown"
  if (/\bandroid\b/.test(uaLower)) os = "android"
  else if (/iphone|ipad|ipod/.test(uaLower)) os = "ios"
  else if (/mac os x|macintosh/.test(uaLower)) os = "macos"
  else if (/\bwindows\b/.test(uaLower)) os = "windows"
  else if (/\blinux\b/.test(uaLower)) os = "linux"

  // Heuristic: iPadOS Safari in "desktop mode" often reports a UA with "Macintosh"
  // and "Mobile" but without "iPad". If we detect that pattern on a touch device,
  // treat it as iOS instead of macOS so recommendations remain correct.
  const nav = navigator as Navigator & { maxTouchPoints?: number }
  const win = typeof window !== "undefined" ? (window as Window & { ontouchstart?: unknown }) : null
  if (
    os === "macos" &&
    /\bmobile\b/.test(uaLower) &&
    (typeof nav.maxTouchPoints === "number"
      ? nav.maxTouchPoints > 0
      : win !== null && typeof win.ontouchstart !== "undefined")
  ) {
    os = "ios"
  }

  let browser: PlatformBrowser = "other"
  if (/\bedge\b|edg\//.test(uaLower)) browser = "edge"
  else if (/\bchrome\b|chromium\b/.test(uaLower) && !/\bedge\b/.test(uaLower))
    browser = "chrome"
  else if (/\bfirefox\b|fxios\b/.test(uaLower)) browser = "firefox"
  else if (/\bsafari\b/.test(uaLower) && !/\bchrome\b/.test(uaLower))
    browser = "safari"

  const isMobileDevice =
    os === "android" || os === "ios" || /mobile|tablet/.test(uaLower)

  return { os, browser, isMobileDevice }
}

const PlatformContext = React.createContext<PlatformInfo>(defaultPlatform)

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatform] = React.useState<PlatformInfo>(defaultPlatform)

  React.useEffect(() => {
    setPlatform(parsePlatform())
  }, [])

  return (
    <PlatformContext.Provider value={platform}>
      {children}
    </PlatformContext.Provider>
  )
}

export function usePlatform(): PlatformInfo {
  const ctx = React.useContext(PlatformContext)
  return ctx ?? defaultPlatform
}
