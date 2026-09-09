"use client"

import { useState } from "react"
import { ArrowRight, Check, ChevronRight, CircleDollarSign, LockKeyhole, Plus, Receipt, ShoppingBasket, Users, X } from "lucide-react"
import { useApp } from "@/lib/app-context"

const groups = [
  { id: "household", name: "Household groceries", note: "Weekly staples and shared errands", members: ["Y", "M", "J"], activity: "Updated 12 min ago", balance: "$24.80 owed to you", color: "bg-primary/15 text-primary" },
  { id: "cabin", name: "Cabin weekend", note: "Lake Tahoe · Sep 20–22", members: ["Y", "A", "S", "K"], activity: "Updated yesterday", balance: "$18.50 you owe", color: "bg-chart-2/15 text-chart-2" },
]

export function ShoppingPage() {
  const { navigateTo } = useApp()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <section className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col gap-6 rounded-2xl border border-border/70 bg-card p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-4">
          <div className="flex items-center gap-3 text-primary"><ShoppingBasket className="size-5" /><span className="font-mono text-xs uppercase tracking-[0.22em]">Private collaboration</span></div>
          <div className="flex flex-col gap-2"><h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">Shopping, without the group chat chaos.</h1><p className="max-w-xl text-sm leading-6 text-muted-foreground">Keep shared requests, receipts, and running balances in one encrypted space. Your private budget stays private.</p></div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><LockKeyhole className="size-3.5 text-primary" />Encrypted for members only</span><span className="flex items-center gap-2"><Users className="size-3.5" />No directory lookups</span></div>
        </div>
        <button onClick={() => setCreateOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"><Plus className="size-4" />Create group</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Active groups" value="2" detail="You’re a member of both" icon={Users} /><Stat label="Open requests" value="7" detail="Across 2 shopping trips" icon={ShoppingBasket} /><Stat label="Running tab" value="$6.30" detail="Net owed to you" icon={CircleDollarSign} /></div>

      <div className="flex flex-col gap-4"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Your groups</h2><p className="text-sm text-muted-foreground">Only people you explicitly invite can see these lists.</p></div><button className="hidden text-sm text-primary hover:underline sm:block" onClick={() => setCreateOpen(true)}>New group</button></div>
        <div className="grid gap-4 lg:grid-cols-2">{groups.map(group => <button key={group.id} onClick={() => navigateTo("shopping-group", group.id)} className="group flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-5 text-left transition hover:border-primary/60 hover:bg-accent/50"><div className="flex items-start justify-between gap-4"><div className={`flex size-11 items-center justify-center rounded-xl ${group.color}`}><ShoppingBasket className="size-5" /></div><ChevronRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" /></div><div className="flex flex-col gap-1"><h3 className="text-lg font-semibold">{group.name}</h3><p className="text-sm text-muted-foreground">{group.note}</p></div><div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4"><div className="flex -space-x-2">{group.members.map((member, index) => <span key={`${member}-${index}`} className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-secondary text-xs font-semibold text-secondary-foreground">{member}</span>)}<span className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] text-muted-foreground">{group.members.length}</span></div><span className="text-right text-xs text-muted-foreground">{group.activity}<br /><strong className={group.id === "household" ? "text-chart-2" : "text-primary"}>{group.balance}</strong></span></div></button>)}</div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" /><p className="leading-6 text-muted-foreground"><strong className="text-foreground">Privacy note.</strong> Shared receipts and balances are visible to group members. Your envelopes, transactions, and account connections are never shared automatically.</p></div>
      {createOpen && <CreateGroup onClose={() => setCreateOpen(false)} onCreate={() => { setCreateOpen(false) }} />}
    </section>
  )
}

function Stat({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Users }) { return <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><Icon className="size-5" /></div><div className="min-w-0"><p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div></div> }

function CreateGroup({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) { const [name, setName] = useState(""); return <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-4 backdrop-blur-sm md:items-center"><div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">New shared space</p><h2 className="mt-2 text-2xl font-semibold">Create a shopping group</h2></div><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-5" /></button></div><div className="mt-6 flex flex-col gap-4"><label className="flex flex-col gap-2 text-sm font-medium">Group name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Apartment groceries" className="rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none ring-primary focus:ring-2" /></label><label className="flex flex-col gap-2 text-sm font-medium">Description <textarea placeholder="What is this group for? (optional)" className="min-h-24 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none ring-primary focus:ring-2" /></label><div className="flex items-start gap-3 rounded-xl bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />Group details are encrypted before they leave your device. You will choose who can access this space next.</div><button onClick={onCreate} disabled={!name.trim()} className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">Create group <ArrowRight className="size-4" /></button></div></div></div> }

export function ShoppingReceiptIcon() { return <Receipt className="size-5" /> }
export function CheckIcon() { return <Check className="size-4" /> }
