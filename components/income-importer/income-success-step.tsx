"use client"

import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import { setDashboardChartMode } from "@/lib/dashboard-chart-mode"
import { Button } from "@/components/ui/button"
import { Megaphone } from "lucide-react"
import { IncomeSuccessParticles } from "@/components/income-importer/income-success-particles"

export const DASHBOARD_CHART_RANGE_OVERRIDE_KEY = "dashboard-chart-range-override"

interface IncomeSuccessStepProps {
  totalUsd: number
  monthCount: number
  opportunityCostEnabled: boolean
  onClose: () => void
}

export function IncomeSuccessStep({
  totalUsd,
  monthCount,
  opportunityCostEnabled,
  onClose,
}: IncomeSuccessStepProps) {
  const { navigateTo } = useApp()

  const goDashboard = () => {
    setDashboardChartMode("savings")
    try {
      sessionStorage.setItem(DASHBOARD_CHART_RANGE_OVERRIDE_KEY, "all")
    } catch {
      /* ignore */
    }
    onClose()
    navigateTo("dashboard")
  }

  return (
    <>
      <IncomeSuccessParticles opportunityCostEnabled={opportunityCostEnabled} />
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <Megaphone
          className="h-14 w-14 text-[#D4AF37] animate-[bounce_1.2s_ease-in-out_infinite]"
          style={{ transformOrigin: "center bottom" }}
          aria-hidden
        />
        <p className="text-lg font-medium text-foreground">
          You imported {formatUsd(totalUsd)} across {monthCount} month{monthCount === 1 ? "" : "s"}.
        </p>
        <Button
          type="button"
          className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
          onClick={goDashboard}
        >
          Go to Dashboard
        </Button>
      </div>
    </>
  )
}
