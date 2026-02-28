"use client"

import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { Plus, Settings2, LogOut } from 'lucide-react'
import { useApp } from "@/lib/app-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function Header() {
  const { setTransactionDialogOpen } = useApp()

  return (
    <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-6 bg-background/80 backdrop-blur-[120px]">
      <BitbudgetLogo />
      <div className="flex items-center gap-3">
        <button
          onClick={() => setTransactionDialogOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors md:hidden"
        >
          <Plus className="h-4 w-4" />
          <span>New</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-10 w-10 rounded-full bg-gradient-to-br from-[#F7931A] to-[#E2761B] hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#F7931A]/30" aria-label="User menu" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-[#0D0D0D] border-[#1F1F1F] text-foreground">
            <DropdownMenuItem className="focus:bg-[#1F1F1F] focus:text-foreground cursor-pointer text-muted-foreground">
              <Settings2 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="focus:bg-[#1F1F1F] focus:text-foreground cursor-pointer text-muted-foreground">
              <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
