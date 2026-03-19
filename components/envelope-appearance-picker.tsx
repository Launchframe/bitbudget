"use client"

import { useRef } from "react"
import { AlertTriangle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { ENVELOPE_ICON_LIST } from "@/lib/envelope-icons"
import { PRESET_ENVELOPE_COLORS } from "@/lib/constants"

export const PRESET_COLORS = PRESET_ENVELOPE_COLORS

export interface ExistingEnvelope {
  id: string
  name: string
  icon?: string | null
}

interface Props {
  color: string
  icon: string
  existingEnvelopes: ExistingEnvelope[]
  editingId?: string | null
  onColorChange: (color: string) => void
  onIconChange: (icon: string) => void
  onReassignIcon: (fromEnvelopeId: string) => void
}

export function EnvelopeAppearancePicker({
  color,
  icon,
  existingEnvelopes,
  editingId,
  onColorChange,
  onIconChange,
  onReassignIcon,
}: Props) {
  const colorInputRef = useRef<HTMLInputElement>(null)

  const conflict = existingEnvelopes.find(
    e => e.icon === icon && e.id !== editingId,
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Color */}
      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Color</Label>
        <div className="flex flex-wrap gap-2 items-center">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onColorChange(c)}
              className={`w-7 h-7 rounded-full transition-all shrink-0 ${
                color === c ? "ring-2 ring-offset-2 ring-offset-[#0D0D0D]" : ""
              }`}
              style={{ backgroundColor: c, "--tw-ring-color": c } as React.CSSProperties}
              aria-label={`Select color ${c}`}
            />
          ))}
          {/* Custom color swatch */}
          <button
            type="button"
            onClick={() => colorInputRef.current?.click()}
            title="Pick custom color"
            className={`w-7 h-7 rounded-full border-2 border-dashed border-[#555] overflow-hidden transition-all shrink-0 ${
              !PRESET_COLORS.includes(color) ? "ring-2 ring-offset-2 ring-offset-[#0D0D0D] ring-white" : "hover:border-[#999]"
            }`}
            style={!PRESET_COLORS.includes(color) ? { backgroundColor: color } : undefined}
            aria-label="Custom color"
          >
            {PRESET_COLORS.includes(color) && (
              <span className="text-[#555] text-xs leading-none">+</span>
            )}
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={color}
            onChange={e => onColorChange(e.target.value)}
            className="sr-only"
            tabIndex={-1}
            aria-label="Custom color picker"
          />
        </div>
      </div>

      {/* Icon */}
      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs uppercase tracking-wider">Icon</Label>
        <div className="grid grid-cols-6 gap-1.5 max-h-52 overflow-y-auto p-1">
          {ENVELOPE_ICON_LIST.map(({ name, Icon }) => {
            const isSelected = icon === name
            return (
              <button
                key={name}
                type="button"
                onClick={() => onIconChange(name)}
                aria-label={name}
                className={`flex items-center justify-center w-full aspect-square rounded-lg transition-all ${
                  isSelected
                    ? "ring-2 ring-inset"
                    : "bg-[#1A1A1A] hover:bg-[#252525]"
                }`}
                style={isSelected ? {
                  backgroundColor: `${color}22`,
                  "--tw-ring-color": color,
                } as React.CSSProperties : undefined}
              >
                <Icon
                  className="h-4 w-4"
                  style={{ color: isSelected ? color : "#666" }}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Duplicate icon warning */}
      {conflict && (
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-300 leading-relaxed">
              This icon is already used by <span className="font-semibold">{conflict.name}</span>.
              Icons work best when they&apos;re unique across envelopes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onReassignIcon(conflict.id)}
            className="self-start text-xs font-medium text-yellow-400 hover:text-yellow-300 underline underline-offset-2 transition-colors"
          >
            Move icon here (remove from {conflict.name})
          </button>
        </div>
      )}
    </div>
  )
}
