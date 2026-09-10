"use client"

import type { Envelope } from "@/lib/data"
import type { WalletReceiveMode } from "@/lib/wallets/xpub-store"

/**
 * Shared form fields for "where does this wallet's money land in the budget".
 * Used by both the xpub tracking card and the BitBudget wallet workspace so
 * the two tiers describe routing with identical language.
 */

export function EnvelopeSelect({
  id,
  value,
  onChange,
  envelopes,
}: {
  id: string
  value: string
  onChange: (id: string) => void
  envelopes: readonly Envelope[]
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 rounded-md border border-[#333] bg-[#1A1A1A] px-3 text-sm text-foreground"
    >
      <option value="">Choose an envelope…</option>
      {envelopes.map((e) => (
        <option key={e.id} value={e.id}>{e.name}</option>
      ))}
    </select>
  )
}

export function ReceiveModeField({
  idPrefix,
  value,
  onChange,
  envelopeName,
}: {
  idPrefix: string
  value: WalletReceiveMode
  onChange: (mode: WalletReceiveMode) => void
  envelopeName?: string
}) {
  const optionClass = (active: boolean) =>
    `flex items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors ${
      active ? "border-[#F7931A] bg-[#F7931A]/5" : "border-[#333] bg-[#1A1A1A] hover:border-[#555]"
    }`
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground mb-1">When this wallet receives bitcoin</legend>
      <button
        type="button"
        role="radio"
        aria-checked={value === "savings"}
        id={`${idPrefix}-receive-savings`}
        onClick={() => onChange("savings")}
        className={optionClass(value === "savings")}
      >
        <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-current flex items-center justify-center">
          {value === "savings" ? <span className="h-2 w-2 rounded-full bg-[#F7931A]" /> : null}
        </span>
        <span>
          <span className="font-medium text-foreground">Add it to Savings</span>
          <span className="block text-xs text-muted-foreground">Works like other money coming in: it grows Savings and refills your envelopes on the 1st.</span>
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "envelope"}
        id={`${idPrefix}-receive-envelope`}
        onClick={() => onChange("envelope")}
        className={optionClass(value === "envelope")}
      >
        <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-current flex items-center justify-center">
          {value === "envelope" ? <span className="h-2 w-2 rounded-full bg-[#F7931A]" /> : null}
        </span>
        <span>
          <span className="font-medium text-foreground">Add it to {envelopeName ? `“${envelopeName}”` : "the spending envelope"}</span>
          <span className="block text-xs text-muted-foreground">Keeps this wallet&apos;s money in one envelope, in and out.</span>
        </span>
      </button>
    </fieldset>
  )
}

/** Plain-language summary of where a wallet's activity lands in the budget. */
export function describeLedgerRouting(
  wallet: { defaultEnvelopeId: string | null; receiveMode: WalletReceiveMode },
  envelopes: readonly Envelope[],
): string {
  const spend = envelopes.find((e) => e.id === wallet.defaultEnvelopeId)?.name
  const spendLabel = spend ? `Spending → ${spend}` : "Spending → choose an envelope"
  const receiveLabel = wallet.receiveMode === "savings"
    ? "Receiving → Savings"
    : spend ? `Receiving → ${spend}` : "Receiving → choose an envelope"
  return `${spendLabel} · ${receiveLabel}`
}
