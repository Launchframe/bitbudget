"use client"

import { useState, useMemo, useRef, createElement } from "react"
import { useApp } from "@/lib/app-context"
import { getEnvelopeBalance, getCurrentMonthKey, formatUsd } from "@/lib/data"
import { Progress } from "@/components/ui/progress"
import { Pencil, Trash2, Plus, SlidersHorizontal, Merge, X, Archive, RotateCcw, ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EnvelopeAppearancePicker, PRESET_COLORS } from "@/components/envelope-appearance-picker"
import { suggestIcon, getEnvelopeIcon, filterSuggestions } from "@/lib/envelope-icons"

export function EnvelopesPage() {
  const { state, navigateTo, addEnvelope, editEnvelope, archiveEnvelope, restoreEnvelope, deleteEnvelope, mergeEnvelope, setMonthlyIncome } = useApp()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formAllotment, setFormAllotment] = useState("")
  const [formColor, setFormColor] = useState("#F7931A")
  const [formIcon, setFormIcon] = useState("Wallet")
  const [iconCustomized, setIconCustomized] = useState(false)
  const [showNameSuggestions, setShowNameSuggestions] = useState(false)
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState("")
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [archiveToast, setArchiveToast] = useState<{ id: string; name: string } | null>(null)
  const archiveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleArchive(envId: string) {
    const env = state.envelopes.find(e => e.id === envId)
    if (!env) return
    archiveEnvelope(envId)
    if (archiveToastTimer.current) clearTimeout(archiveToastTimer.current)
    setArchiveToast({ id: envId, name: env.name })
    archiveToastTimer.current = setTimeout(() => setArchiveToast(null), 5000)
  }

  function handleUndoArchive() {
    if (!archiveToast) return
    restoreEnvelope(archiveToast.id)
    setArchiveToast(null)
    if (archiveToastTimer.current) clearTimeout(archiveToastTimer.current)
  }

  const activeEnvelopes = useMemo(
    () => state.envelopes.filter(e => !e.archived),
    [state.envelopes]
  )
  const archivedEnvelopes = useMemo(
    () => state.envelopes.filter(e => e.archived),
    [state.envelopes]
  )

  const currentMonth = getCurrentMonthKey()

  const totalAllocated = useMemo(
    () => activeEnvelopes.reduce((sum, e) => sum + e.monthlyAllotment, 0),
    [activeEnvelopes]
  )
  const unallocated = state.monthlyIncome - totalAllocated

  /** Icon shown in the dialog and saved on submit: suggestion from name until user picks manually. */
  const displayFormIcon = useMemo(() => {
    if (iconCustomized) return formIcon
    const t = formName.trim()
    return t ? suggestIcon(t) : formIcon
  }, [iconCustomized, formIcon, formName])

  function openAddDialog() {
    setEditingId(null)
    setFormName("")
    setFormAllotment("")
    const usedColors = new Set(activeEnvelopes.map(e => e.color))
    const nextColor = PRESET_COLORS.find(c => !usedColors.has(c)) ?? "#F7931A"
    setFormColor(nextColor)
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

  function handleIconChange(icon: string) {
    setFormIcon(icon)
    setIconCustomized(true)
  }

  function handleReassignIcon(fromEnvelopeId: string) {
    setFormIcon(displayFormIcon) // freeze displayed icon for this envelope
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
        icon: displayFormIcon,
      })
    } else {
      addEnvelope({
        name: formName.trim(),
        monthlyAllotment: parseFloat(formAllotment),
        color: formColor,
        icon: displayFormIcon,
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
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Allocated</span>
            <span className="text-lg font-semibold text-foreground">{formatUsd(totalAllocated)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Savings</span>
            <span className={`text-lg font-semibold ${unallocated >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              {formatUsd(unallocated)}
            </span>
          </div>
          {activeEnvelopes.length > 0 && (
            <button
              type="button"
              onClick={() => navigateTo("envelope-allocations")}
              className="ml-auto p-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-muted-foreground hover:text-foreground hover:border-[#555] transition-colors"
              title="Adjust allocations"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Envelope cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeEnvelopes.map((env) => {
          const balance = getEnvelopeBalance(state.transactions, env.id, currentMonth, env.monthlyAllotment)
          const percentage = env.monthlyAllotment > 0 ? Math.max(0, (balance / env.monthlyAllotment) * 100) : 0
          const healthColor = percentage > 25 ? "#22C55E" : percentage > 10 ? "#EAB308" : "#EF4444"
          const Icon = getEnvelopeIcon(env.icon)

          return (
            <div
              key={env.id}
              className="flex flex-col bg-[#0D0D0D] rounded-2xl hover:bg-[#111] transition-colors overflow-hidden"
            >
              <button
                onClick={() => navigateTo("transactions", undefined, { envelopeFilter: env.id })}
                className="flex flex-col gap-4 p-5 text-left flex-1"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${env.color}22` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: env.color }} />
                  </div>
                  <span className="font-semibold text-foreground truncate">{env.name}</span>
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

              <div className="flex items-center border-t border-[#1A1A1A]">
                <button
                  onClick={() => openEditDialog(env.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A] transition-colors"
                  aria-label={`Edit ${env.name}`}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                <div className="w-px h-5 bg-[#1A1A1A]" />
                <button
                  onClick={() => { setMergeSourceId(env.id); setMergeDialogOpen(true) }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-[#3B82F6] hover:bg-[#1A1A1A] transition-colors"
                  aria-label={`Merge ${env.name}`}
                >
                  <Merge className="h-3 w-3" /> Merge
                </button>
                <div className="w-px h-5 bg-[#1A1A1A]" />
                <button
                  onClick={() => handleArchive(env.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-amber-400 hover:bg-[#1A1A1A] transition-colors"
                  aria-label={`Archive ${env.name}`}
                >
                  <Archive className="h-3 w-3" /> Archive
                </button>
              </div>
            </div>
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
              <div className="relative">
                <Input
                  value={formName}
                  onChange={(e) => { setFormName(e.target.value); setShowNameSuggestions(true) }}
                  onFocus={() => setShowNameSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
                  onKeyDown={(e) => { if (e.key === "Escape") setShowNameSuggestions(false) }}
                  placeholder="e.g. Groceries"
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                  required
                  autoComplete="off"
                />
                {showNameSuggestions && !editingId && (() => {
                  const existingNames = new Set(activeEnvelopes.map(e => e.name.toLowerCase()))
                  const filtered = filterSuggestions(formName, existingNames)
                  if (filtered.length === 0) return null
                  return (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#333] rounded-lg max-h-48 overflow-y-auto shadow-xl">
                      {filtered.map(name => {
                        const SugIcon = getEnvelopeIcon(suggestIcon(name))
                        return (
                          <button
                            key={name}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setFormName(name); setShowNameSuggestions(false) }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-[#252525] transition-colors text-left"
                          >
                            <SugIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
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
              icon={displayFormIcon}
              existingEnvelopes={activeEnvelopes}
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

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Merge Envelope</DialogTitle>
          </DialogHeader>
          {(() => {
            const source = state.envelopes.find(e => e.id === mergeSourceId)
            if (!source) return null
            const txnCount = state.transactions.filter(t => t.envelopeId === source.id).length
            const targets = activeEnvelopes.filter(e => e.id !== mergeSourceId)
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1A1A1A]">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${source.color}22` }}
                  >
                    {createElement(getEnvelopeIcon(source.icon), {
                      className: "h-4 w-4",
                      style: { color: source.color },
                    })}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{source.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {txnCount} transaction{txnCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                  All transactions will be moved to the destination envelope. <span className="font-medium text-foreground">{source.name}</span> will then be removed.
                </p>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Merge into</span>
                  <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                    {targets.map(target => {
                      const TargetIcon = getEnvelopeIcon(target.icon)
                      return (
                        <button
                          key={target.id}
                          type="button"
                          onClick={async () => {
                            await mergeEnvelope(source.id, target.id)
                            setMergeDialogOpen(false)
                            setMergeSourceId(null)
                          }}
                          className="flex items-center gap-3 p-3 rounded-xl hover:bg-[#1A1A1A] transition-colors text-left"
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${target.color}22` }}
                          >
                            <TargetIcon className="h-4 w-4" style={{ color: target.color }} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">{target.name}</span>
                            <span className="text-xs text-muted-foreground">{formatUsd(target.monthlyAllotment)}/mo</span>
                          </div>
                          <Merge className="h-4 w-4 text-muted-foreground ml-auto" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Archived envelopes section */}
      {archivedEnvelopes.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setArchivedExpanded(prev => !prev)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
          >
            <Archive className="h-4 w-4" />
            Archived ({archivedEnvelopes.length})
            <ChevronDown className={`h-4 w-4 transition-transform ${archivedExpanded ? "rotate-180" : ""}`} />
          </button>

          {archivedExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {archivedEnvelopes.map((env) => {
                const Icon = getEnvelopeIcon(env.icon)
                const txnCount = state.transactions.filter(t => t.envelopeId === env.id).length
                return (
                  <div
                    key={env.id}
                    className="flex flex-col bg-[#0D0D0D] rounded-2xl overflow-hidden opacity-60 hover:opacity-80 transition-opacity"
                  >
                    <div className="flex items-center gap-3 p-5">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${env.color}22` }}
                      >
                        <Icon className="h-4 w-4" style={{ color: env.color }} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-foreground truncate">{env.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {txnCount} transaction{txnCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center border-t border-[#1A1A1A]">
                      <button
                        onClick={() => restoreEnvelope(env.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-[#22C55E] hover:bg-[#1A1A1A] transition-colors"
                        aria-label={`Restore ${env.name}`}
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                      <div className="w-px h-5 bg-[#1A1A1A]" />
                      <button
                        onClick={() => deleteEnvelope(env.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-[#EF4444] hover:bg-[#1A1A1A] transition-colors"
                        aria-label={`Permanently delete ${env.name}`}
                      >
                        <Trash2 className="h-3 w-3" /> Delete Forever
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Archive undo toast */}
      {archiveToast && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border border-[#333] rounded-xl shadow-xl animate-in slide-in-from-bottom-4 fade-in duration-200">
          <Archive className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm text-foreground">
            <span className="font-medium">{archiveToast.name}</span> archived
          </span>
          <button
            type="button"
            onClick={handleUndoArchive}
            className="text-sm font-semibold text-[#F7931A] hover:text-[#F7931A]/80 transition-colors ml-2"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setArchiveToast(null)}
            className="text-muted-foreground hover:text-foreground transition-colors ml-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
