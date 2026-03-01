"use client"

import { useState, useMemo } from "react"
import { useApp } from "@/lib/app-context"
import { getEnvelopeBalance, getCurrentMonthKey, formatUsd } from "@/lib/data"
import { Progress } from "@/components/ui/progress"
import { Pencil, Trash2, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]

export function EnvelopesPage() {
  const { state, navigateTo, addEnvelope, editEnvelope, deleteEnvelope, setMonthlyIncome } = useApp()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formAllotment, setFormAllotment] = useState("")
  const [formColor, setFormColor] = useState(ENVELOPE_COLORS[0])
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState("")

  const currentMonth = getCurrentMonthKey()

  const totalAllocated = useMemo(
    () => state.envelopes.reduce((sum, e) => sum + e.monthlyAllotment, 0),
    [state.envelopes]
  )
  const unallocated = state.monthlyIncome - totalAllocated

  function openAddDialog() {
    setEditingId(null)
    setFormName("")
    setFormAllotment("")
    setFormColor(ENVELOPE_COLORS[state.envelopes.length % ENVELOPE_COLORS.length])
    setDialogOpen(true)
  }

  function openEditDialog(envId: string) {
    const env = state.envelopes.find((e) => e.id === envId)
    if (!env) return
    setEditingId(envId)
    setFormName(env.name)
    setFormAllotment(String(env.monthlyAllotment))
    setFormColor(env.color)
    setDialogOpen(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim() || !formAllotment) return
    if (editingId) {
      editEnvelope(editingId, {
        name: formName.trim(),
        monthlyAllotment: parseFloat(formAllotment),
        color: formColor,
      })
    } else {
      addEnvelope({
        name: formName.trim(),
        monthlyAllotment: parseFloat(formAllotment),
        color: formColor,
      })
    }
    setDialogOpen(false)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Income header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Income</span>
          {editingIncome ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                value={incomeValue}
                onChange={(e) => setIncomeValue(e.target.value)}
                onKeyDown={(e) => {
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
                className="bg-[#1A1A1A] border-[#333] text-foreground h-9 w-36"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => {
                setIncomeValue(String(state.monthlyIncome))
                setEditingIncome(true)
              }}
              className="text-3xl font-bold text-foreground hover:text-[#F7931A] transition-colors text-left"
            >
              {formatUsd(state.monthlyIncome)}
            </button>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Allocated</span>
            <span className="text-lg font-semibold text-foreground">{formatUsd(totalAllocated)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Unallocated</span>
            <span className={`text-lg font-semibold ${unallocated >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              {formatUsd(unallocated)}
            </span>
          </div>
        </div>
      </div>

      {/* Envelope cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.envelopes.map((env) => {
          const balance = getEnvelopeBalance(state.transactions, env.id, currentMonth, env.monthlyAllotment)
          const percentage = env.monthlyAllotment > 0 ? Math.max(0, (balance / env.monthlyAllotment) * 100) : 0
          const healthColor = percentage > 25 ? "#22C55E" : percentage > 10 ? "#EAB308" : "#EF4444"

          return (
            <button
              key={env.id}
              onClick={() => navigateTo("envelope-detail", env.id)}
              className="flex flex-col gap-4 p-5 bg-[#0D0D0D] rounded-2xl hover:bg-[#111] transition-colors text-left group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: env.color }} />
                  <span className="font-semibold text-foreground">{env.name}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      openEditDialog(env.id)
                    }}
                    className="p-1.5 rounded-md hover:bg-[#1F1F1F] text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Edit ${env.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteEnvelope(env.id)
                    }}
                    className="p-1.5 rounded-md hover:bg-[#1F1F1F] text-muted-foreground hover:text-[#EF4444] transition-colors"
                    aria-label={`Delete ${env.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{formatUsd(env.monthlyAllotment)}/mo</span>
                  <span style={{ color: healthColor }} className="font-medium">
                    {formatUsd(balance)} left
                  </span>
                </div>
                <Progress
                  value={Math.min(100, percentage)}
                  className="h-2"
                  style={{
                    // @ts-expect-error - CSS custom properties
                    "--progress-color": healthColor,
                  }}
                />
              </div>
            </button>
          )
        })}

        {/* Add envelope card */}
        <button
          onClick={openAddDialog}
          className="flex flex-col items-center justify-center gap-3 p-5 bg-[#0D0D0D] rounded-2xl border-2 border-dashed border-[#1F1F1F] hover:border-[#F7931A]/30 hover:bg-[#111] transition-colors min-h-[130px]"
        >
          <div className="p-2 rounded-lg bg-[#F7931A]/10">
            <Plus className="h-5 w-5 text-[#F7931A]" />
          </div>
          <span className="text-sm text-muted-foreground">Add Envelope</span>
        </button>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Envelope" : "New Envelope"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Groceries"
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Monthly Allotment</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={formAllotment}
                  onChange={(e) => setFormAllotment(e.target.value)}
                  placeholder="0"
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7"
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Color</Label>
              <div className="flex gap-2">
                {ENVELOPE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormColor(color)}
                    className={`w-8 h-8 rounded-full transition-all ${
                      formColor === color ? "ring-2 ring-offset-2 ring-offset-[#0D0D0D]" : ""
                    }`}
                    style={{
                      backgroundColor: color,
                      "--tw-ring-color": color,
                    } as React.CSSProperties}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-lg font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors mt-2"
            >
              {editingId ? "Save Changes" : "Create Envelope"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
