"use client"

import { SuccessParticles } from "@/components/success-particles"
import { TransactionSuccessHero } from "@/components/transaction-success-hero"
import { formatUsdPrecise } from "@/lib/data"

interface TransactionSuccessViewProps {
  message: string
  payee: string
  amount: number
  opportunityCostEnabled: boolean
  onDone: () => void
}

export function TransactionSuccessView({
  message,
  payee,
  amount,
  opportunityCostEnabled,
  onDone,
}: TransactionSuccessViewProps) {
  return (
    <>
      <SuccessParticles opportunityCostEnabled={opportunityCostEnabled} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
          <TransactionSuccessHero opportunityCostEnabled={opportunityCostEnabled} />
          <div className="flex flex-col gap-2 max-w-sm">
            <p className="text-lg font-semibold text-foreground leading-snug">{message}</p>
            <p className="text-sm text-muted-foreground">
              Logged{" "}
              <span className="font-medium text-foreground">{payee}</span>
              {" · "}
              <span className="font-ibm-plex-mono font-medium text-foreground">
                {formatUsdPrecise(amount)}
              </span>
            </p>
          </div>
        </div>
        <div className="shrink-0 border-t border-[#1F1F1F] bg-[#0D0D0D] px-6 py-4">
          <button
            type="button"
            onClick={onDone}
            className="w-full rounded-lg bg-[#F7931A] py-3 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
          >
            Done
          </button>
        </div>
      </div>
    </>
  )
}
