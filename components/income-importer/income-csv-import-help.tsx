"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function IncomeCsvImportHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#222] hover:text-foreground focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/60"
          aria-label="CSV import format help"
        >
          <Info className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(20rem,calc(100vw-2rem))] border-[#333] bg-[#1A1A1A] p-3 text-foreground shadow-lg"
      >
        <p className="text-sm font-medium text-foreground">CSV import format</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload a .csv file to fill the calendar by month. You can still edit any month before you save.
        </p>

        <div className="mt-3 space-y-2 text-xs">
          <div>
            <p className="font-medium text-foreground">Required columns</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>
                <span className="text-foreground">Date</span> —{" "}
                <span className="font-mono">YYYY-MM-DD</span> or{" "}
                <span className="font-mono">M/D/YYYY</span>
              </li>
              <li>
                <span className="text-foreground">Amount</span> — positive number (also accepts{" "}
                <span className="font-mono">Income</span> or <span className="font-mono">Pay</span>)
              </li>
            </ul>
          </div>

          <div>
            <p className="font-medium text-foreground">Optional column</p>
            <p className="mt-1 text-muted-foreground">
              <span className="text-foreground">Source</span> — paycheck label (also{" "}
              <span className="font-mono">Label</span>, <span className="font-mono">Payee</span>,{" "}
              <span className="font-mono">Name</span>, <span className="font-mono">Employer</span>, or{" "}
              <span className="font-mono">Description</span>)
            </p>
          </div>

          <div>
            <p className="font-medium text-foreground">Example</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-[#333] bg-[#111] p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {`Date,Amount,Source
2024-01-15,5000,Employer
2024-02-01,5200,Employer`}
            </pre>
          </div>

          <div>
            <p className="font-medium text-foreground">How rows are handled</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>Rows are grouped by calendar month; multiple rows in the same month are added together.</li>
              <li>Rows with missing dates, zero amounts, negative amounts, or future dates are skipped.</li>
              <li>Dollar signs and commas in amounts are fine.</li>
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
