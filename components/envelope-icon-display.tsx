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
 */
export function EnvelopeIconDisplay({ icon, fallbackName, className, style }: EnvelopeIconDisplayProps) {
  if (isLettersEnvelopeIcon(icon)) {
    const text = getLettersEnvelopeIconText(icon)
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center font-bold tabular-nums leading-none tracking-tight select-none",
          className,
        )}
        style={{ 
          fontSize: '1.0rem',
          ...style,
        }}
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
        "inline-flex items-center justify-center font-bold tabular-nums leading-none tracking-tight select-none",
        className,
      )}
      style={style}
    >
      {text}
    </span>
  )
}
