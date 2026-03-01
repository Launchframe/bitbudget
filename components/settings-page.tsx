"use client"

import { useState, useRef } from "react"
import { signOut } from "next-auth/react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import { Upload, Shield, DollarSign, Trash2, UserX } from "lucide-react"

export function SettingsPage() {
  const { state, setMonthlyIncome, refreshData } = useApp()
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState(String(state.monthlyIncome))
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleClearAll() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await Promise.all([
        fetch("/api/transactions?all=true", { method: "DELETE" }),
        fetch("/api/envelopes?all=true", { method: "DELETE" }),
      ])
      await refreshData()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportOpen(true)
    e.target.value = ""
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-foreground">Settings</h2>

      {/* Income */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#22C55E]/10">
            <DollarSign className="h-5 w-5 text-[#22C55E]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Monthly Income</h3>
        </div>
        {editingIncome ? (
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">$</span>
            <Input
              type="number"
              value={incomeValue}
              onChange={e => setIncomeValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  setMonthlyIncome(parseFloat(incomeValue) || state.monthlyIncome)
                  setEditingIncome(false)
                }
                if (e.key === "Escape") setEditingIncome(false)
              }}
              onBlur={() => {
                setMonthlyIncome(parseFloat(incomeValue) || state.monthlyIncome)
                setEditingIncome(false)
              }}
              className="bg-[#1A1A1A] border-[#333] text-foreground h-10 w-40"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setIncomeValue(String(state.monthlyIncome))
              setEditingIncome(true)
            }}
            className="text-3xl font-bold text-foreground hover:text-[#F7931A] transition-colors"
          >
            {formatUsd(state.monthlyIncome)}
          </button>
        )}
      </div>

      {/* CSV Import */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#06B6D4]/10">
            <Upload className="h-5 w-5 text-[#06B6D4]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Import Transactions</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Upload a CSV file with columns: Date, Envelope, Name, Amount
        </p>
        <div className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 py-3 px-6 bg-[#1A1A1A] text-foreground rounded-xl text-sm font-medium hover:bg-[#222] transition-colors border border-[#333]"
          >
            <Upload className="h-4 w-4" />
            Choose CSV File
          </button>
        </div>
      </div>

      {/* Security Info */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#8B5CF6]/10">
            <Shield className="h-5 w-5 text-[#8B5CF6]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Privacy & Security</h3>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Your sensitive transaction data (payees, descriptions) is encrypted end-to-end.
            Only you can decrypt it with your PIN or Nostr key.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <span className="text-xs text-[#22C55E]">Encryption active</span>
          </div>
        </div>
      </div>

      {/* Data */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <h3 className="text-lg font-semibold text-foreground mb-3">Data Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelopes</Label>
            <p className="text-lg font-semibold text-foreground">{state.envelopes.length}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Transactions</Label>
            <p className="text-lg font-semibold text-foreground">{state.transactions.length}</p>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl border border-red-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-red-500/10">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Danger Zone</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Permanently delete all {state.transactions.length} transaction{state.transactions.length !== 1 ? "s" : ""} and {state.envelopes.length} envelope{state.envelopes.length !== 1 ? "s" : ""}. This cannot be undone.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleClearAll}
            onBlur={() => setConfirmDelete(false)}
            disabled={deleting || (state.transactions.length === 0 && state.envelopes.length === 0)}
            className={`flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-medium transition-colors border disabled:opacity-50 ${
              confirmDelete
                ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                : "bg-[#1A1A1A] text-red-400 border-red-500/30 hover:bg-red-500/10"
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Deleting..." : confirmDelete ? "Click again to confirm" : "Clear All Data"}
          </button>
          <button
            onClick={async () => {
              if (!confirmDeleteAccount) {
                setConfirmDeleteAccount(true)
                return
              }
              setDeletingAccount(true)
              try {
                await fetch("/api/user/delete", { method: "DELETE" })
                signOut({ callbackUrl: "/auth" })
              } finally {
                setDeletingAccount(false)
                setConfirmDeleteAccount(false)
              }
            }}
            onBlur={() => setConfirmDeleteAccount(false)}
            disabled={deletingAccount}
            className={`flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-medium transition-colors border disabled:opacity-50 ${
              confirmDeleteAccount
                ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                : "bg-[#1A1A1A] text-red-400 border-red-500/30 hover:bg-red-500/10"
            }`}
          >
            <UserX className="h-4 w-4" />
            {deletingAccount ? "Deleting..." : confirmDeleteAccount ? "Click again to confirm" : "Delete My Account"}
          </button>
        </div>
      </div>

      <CSVImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        file={importFile}
        onImportComplete={refreshData}
      />
    </div>
  )
}
