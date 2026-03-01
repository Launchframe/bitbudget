"use client"

import { useState } from "react"
import { signOut, useSession } from "next-auth/react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { Settings2, LogOut, Upload } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function Header() {
  const { setTransactionDialogOpen, navigateTo, refreshData } = useApp()
  const { data: session } = useSession()
  const userImage = session?.user?.image
  const userName = session?.user?.name
  const userEmail = session?.user?.email
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportOpen(true)
    e.target.value = ""
  }

  return (
    <>
      <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-3 py-4 md:p-6 bg-background/80 backdrop-blur-[120px]">
        <BitbudgetLogo />
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-[#F7931A] to-[#E2761B] hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#F7931A]/30" aria-label="User menu">
                {userImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userImage} alt="" className="h-full w-full object-cover" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-[#0D0D0D] border-[#1F1F1F] text-foreground">
              {(userName || userEmail) && (
                <div className="px-2 py-2.5 border-b border-[#1F1F1F] mb-1">
                  {userName && <p className="text-sm font-medium text-foreground truncate">{userName}</p>}
                  {userEmail && <p className="text-xs text-muted-foreground truncate">{userEmail}</p>}
                </div>
              )}
              <DropdownMenuItem
                onClick={() => navigateTo("settings")}
                className="focus:bg-[#1F1F1F] focus:text-foreground cursor-pointer text-muted-foreground"
              >
                <Settings2 className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => document.getElementById("csv-import-input")?.click()}
                className="focus:bg-[#1F1F1F] focus:text-foreground cursor-pointer text-muted-foreground"
              >
                <Upload className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Import CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/auth" })}
                className="focus:bg-[#1F1F1F] focus:text-foreground cursor-pointer text-muted-foreground"
              >
                <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            id="csv-import-input"
            type="file"
            accept=".csv"
            onChange={handleFileSelected}
            className="hidden"
          />
        </div>
      </header>
      <CSVImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        file={importFile}
        onImportComplete={refreshData}
        onDone={() => navigateTo("envelopes")}
      />
    </>
  )
}
