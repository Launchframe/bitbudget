"use client"

import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import {
  getEnvelopeIcon,
  getLettersEnvelopeIconText,
  isLettersEnvelopeIcon,
} from "@/lib/envelope-icons"

interface EnvelopeIconDisplayProps {
  icon: string | null | undefined
  className?: string
  style?: CSSProperties
}

/**
 * Renders a Lucide envelope icon or bold initials when `icon` uses `LETTERS_ENVELOPE_ICON_PREFIX`.
 */
export function EnvelopeIconDisplay({ icon, className, style }: EnvelopeIconDisplayProps) {
  if (isLettersEnvelopeIcon(icon)) {
    const text = getLettersEnvelopeIconText(icon)
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
  const Icon = getEnvelopeIcon(icon)
  return <Icon className={className} style={style} />
}
