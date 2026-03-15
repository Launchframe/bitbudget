"use client"

import { useState, useMemo, useEffect } from "react"
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
import { EnvelopeAppearancePicker } from "@/components/envelope-appearance-picker"
import { suggestIcon, getEnvelopeIcon } from "@/lib/envelope-icons"

export function EnvelopesPage() {
  const { state, navigateTo, addEnvelope, editEnvelope, deleteEnvelope, setMonthlyIncome } = useApp()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formAllotment, setFormAllotment] = useState("")
  const [formColor, setFormColor] = useState("#F7931A")
  const [formIcon, setFormIcon] = useState("Wallet")
  const [iconCustomized, setIconCustomized] = useState(false)
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
    setFormColor("#F7931A")
    setFormIcon("Wallet")
    setIconCustomized(false)
    setDialogOpen(true)
  }

  function openEditDialog(envId: string) {
    const env = state.envelopes.find((e) => e.id === envId)
    if (!env) return
    setEditingId(envId)
    setFormName(env.name)
    setFormAllotment(String(env.monthlyAllotment))
    setFormColor(env.color)
    setFormIcon(env.icon || suggestIcon(env.name))
    setIconCustomized(true)
    setDialogOpen(true)
  }

  // Auto-suggest icon when name changes (unless user has manually chosen one)
  useEffect(() => {
    if (!iconCustomized && formName.trim()) {
      setFormIcon(suggestIcon(formName))
    }
  }, [formName, iconCustomized])

  function handleIconChange(icon: string) {
    setFormIcon(icon)
    setIconCustomized(true)
  }

  function handleReassignIcon(fromEnvelopeId: string) {
    setFormIcon(formIcon) // keep current icon for this envelope
    editEnvelope(fromEnvelopeId, { icon: null })
    setIconCustomized(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim() || !formAllotment) return
    if (editingId) {
      editEnvelope(editingId, {
        name: formName.trim(),
        monthlyAllotment: parseFloat(formAllotment),
        color: formColor,
        icon: formIcon,
      })
    } else {
      addEnvelope({
        name: formName.trim(),
        monthlyAllotment: parseFloat(formAllotment),
        color: formColor,
        icon: formIcon,
      })
    }
    setDialogOpen(false)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Income header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
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
          const Icon = getEnvelopeIcon(env.icon)

          return (
            <button
              key={env.id}
              onClick={() => navigateTo("envelope-detail", env.id)}
              className="flex flex-col gap-4 p-5 bg-[#0D0D0D] rounded-2xl hover:bg-[#111] transition-colors text-left group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${env.color}22` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: env.color }} />
                  </div>
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
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Envelope" : "New Envelope"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Name */}
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

            {/* Monthly Allotment */}
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

            {/* Color + Icon picker */}
            <EnvelopeAppearancePicker
              color={formColor}
              icon={formIcon}
              existingEnvelopes={state.envelopes}
              editingId={editingId}
              onColorChange={setFormColor}
              onIconChange={handleIconChange}
              onReassignIcon={handleReassignIcon}
            />

            <button
              type="submit"
              className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-lg font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors mt-1"
            >
              {editingId ? "Save Changes" : "Create Envelope"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
