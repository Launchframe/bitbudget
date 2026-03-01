"use client"

import { BtcPriceChart } from "@/components/btc-price-chart"

export function BtcPricePage() {
  return (
    <div className="flex flex-col gap-6">
      <BtcPriceChart />
    </div>
  )
}
