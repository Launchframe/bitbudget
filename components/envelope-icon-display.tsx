"use client"

import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import {
  ENVELOPE_ICONS,
  getLettersEnvelopeIconText,
  isLettersEnvelopeIcon,
  initialsForEnvelopeName,
} from "@/lib/envelope-icons"

interface EnvelopeIconDisplayProps {
  icon: string | null | undefined
  /** When icon is missing or not a known Lucide name, show initials from this name. */
  fallbackName?: string
  className?: string
  style?: CSSProperties
}

/**
 * Renders a Lucide envelope icon, persisted letter placeholder (`__bb_letters__:…`),
 * or bold initials from `fallbackName` when there is no usable icon.
 *
 * **Sizing:** Lucide icons follow `h-*` / `w-*` on `className`. Letter placeholders default
 * to `text-base`; override with `text-sm`, `text-[10px]`, etc. — `cn`/`tailwind-merge` lets
 * caller utilities win so compact chips stay small while icons in the same slot stay unchanged.
 */
export function EnvelopeIconDisplay({ icon, fallbackName, className, style }: EnvelopeIconDisplayProps) {
  if (isLettersEnvelopeIcon(icon)) {
    const text = getLettersEnvelopeIconText(icon)
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center font-bold tabular-nums leading-none tracking-tight select-none text-base",
          className,
        )}
        style={style}
      >
        {text}
      </span>
    )
  }
  if (icon && ENVELOPE_ICONS[icon]) {
    const Icon = ENVELOPE_ICONS[icon]
    return <Icon className={className} style={style} />
  }
  const text = initialsForEnvelopeName(fallbackName ?? "")
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center font-bold tabular-nums leading-none tracking-tight select-none text-base",
        className,
      )}
      style={style}
    >
      {text}
    </span>
  )
}
