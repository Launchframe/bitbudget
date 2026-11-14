"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  LockKeyhole,
  Plus,
  ShoppingBasket,
  Users,
} from "lucide-react"
import { generateKeyPairFromSeed, publicKeyToHex } from "@/lib/crypto"
import { useApp } from "@/lib/app-context"
import { formatShoppingFingerprintDisplay, publicKeyFingerprint } from "@/lib/shopping-crypto"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"
import {
  aliasInitials,
  decryptShoppingJson,
  formatShoppingUpdatedAt,
  parseGroupMetadata,
  parseMemberAlias,
  shoppingAad,
} from "@/lib/shopping-payloads"
import { prepareCreateGroup, prepareDefaultList } from "@/lib/shopping-prepare"
import { unwrapCurrentGroupKey } from "@/lib/shopping-view"
import { useShoppingState, type ShoppingGroupSummary } from "@/lib/use-shopping-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface GroupCard {
  id: string
  name: string
  description?: string
  updatedAt: string
  memberCount: number
  myInitials: string
  unreadable: boolean
}

const EMPTY_GROUP_CARDS: GroupCard[] = []

export function ShoppingPage() {
  const { navigateTo, withPrivacyKey } = useApp()
  const shopping = useShoppingState()
  const [createOpen, setCreateOpen] = useState(false)
  const [cards, setCards] = useState<GroupCard[]>([])
  const [claimAlias, setClaimAlias] = useState("")
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimReceipt, setClaimReceipt] = useState<{ code: string; fingerprint: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await withPrivacyKey(async (privacyKey) => {
        const decrypted: GroupCard[] = []
        for (const group of shopping.groups) {
          decrypted.push(await decryptGroupCard(group, privacyKey))
        }
        return decrypted
      })
      if (cancelled) return
      // Avoid setState when unchanged — a new [] each time would re-render forever
      // if shopping.groups were also referentially unstable.
      setCards((prev) => {
        const resolved = next ?? EMPTY_GROUP_CARDS
        if (prev.length === 0 && resolved.length === 0) return prev
        return resolved
      })
    })()
    return () => {
      cancelled = true
    }
  }, [shopping.groups, withPrivacyKey])

  async function onCreate(name: string, description: string, alias: string) {
    const result = await withPrivacyKey(async (privacyKey) => {
      const prepared = await prepareCreateGroup({
        privacyKey,
        name,
        description: description.trim() || undefined,
        alias,
      })
      await shopping.createGroup(prepared.body)
      const list = await prepareDefaultList({
        groupId: prepared.groupId,
        groupKey: prepared.groupKey,
        keyVersion: prepared.keyVersion,
      })
      await shopping.createList(prepared.groupId, {
        id: list.id,
        encryptedPayload: list.encryptedPayload,
        keyVersion: list.keyVersion,
      })
      return prepared.groupId
    })
    if (result) navigateTo("shopping-group", result)
  }

  async function onClaim() {
    setClaimBusy(true)
    setClaimError(null)
    try {
      const encrypted = await shopping.encryptAliasToOwner(claimAlias.trim())
      if (!encrypted) {
        setClaimError("This invite is missing a key. Ask the owner to send a new link.")
        return
      }
      const result = await shopping.submitPendingInvite(encrypted)
      if (!result.ok) {
        setClaimError(result.error)
        return
      }
      const fingerprint = await withPrivacyKey(async (key) => {
        const { publicKey } = generateKeyPairFromSeed(key)
        return publicKeyFingerprint(publicKeyToHex(publicKey))
      })
      setClaimReceipt({
        code: result.verificationCode,
        fingerprint: fingerprint ?? "",
      })
    } finally {
      setClaimBusy(false)
    }
  }

  return (
    <section className="flex min-w-0 w-full max-w-full flex-col gap-6 pb-10">
      <div className="flex flex-col gap-6 rounded-2xl border border-border/70 bg-card p-4 sm:p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 max-w-2xl flex-col gap-4">
          <div className="flex items-center gap-3 text-primary">
            <ShoppingBasket className="size-5" />
            <span className="font-mono text-xs uppercase tracking-[0.22em]">Private lists</span>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Shared shopping, private budgets.
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Keep requests, receipts, and a running tab with people you invite. Group members never
              see your envelopes or transactions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <LockKeyhole className="size-3.5 text-primary" />
              Encrypted for members only
            </span>
            <span className="flex items-center gap-2">
              <Users className="size-3.5" />
              Invite-only — no directory
            </span>
          </div>
        </div>
        <Button
          type="button"
          className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground sm:w-auto"
          onClick={() => setCreateOpen(true)}
          disabled={!shopping.unlocked}
        >
          <Plus className="size-4" />
          Create group
        </Button>
      </div>

      {claimReceipt && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
          <p className="font-medium">Request sent</p>
          <p className="text-sm text-muted-foreground">
            Read these to the group owner on a call or in person. They should match before you are added.
          </p>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Join code</p>
            <p className="font-mono text-2xl tracking-[0.2em]">{claimReceipt.code}</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Your compare code</p>
            <p className="font-mono text-xl tracking-widest">
              {formatShoppingFingerprintDisplay(claimReceipt.fingerprint)}
            </p>
          </div>
          <Button type="button" variant="ghost" className="w-fit" onClick={() => setClaimReceipt(null)}>
            Done
          </Button>
        </div>
      )}
      {shopping.pendingInvite && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
          <p className="font-medium">You have a shopping invite</p>
          <p className="text-sm text-muted-foreground">
            Choose the name others in this group will see. The owner will check a short code with you
            before adding you.
          </p>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Your name in this group
            <Input
              value={claimAlias}
              onChange={(e) => setClaimAlias(e.target.value)}
              placeholder="e.g. Alex"
              autoComplete="nickname"
            />
          </label>
          {claimError && <p className="text-sm text-destructive">{claimError}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={() => void onClaim()}
              disabled={claimBusy || !shopping.unlocked || !claimAlias.trim()}
            >
              Send join request
            </Button>
            <Button type="button" variant="ghost" onClick={() => shopping.clearPendingInvite()}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {!shopping.unlocked && (
        <p className="text-sm text-muted-foreground">Unlock your data to see shared lists.</p>
      )}
      {shopping.error && <p className="text-sm text-destructive">{shopping.error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Active groups"
          value={String(shopping.groups.length)}
          detail={shopping.loading ? "Loading…" : "Groups you belong to"}
          icon={Users}
        />
        <Stat
          label="Lists"
          value={String(cards.filter((c) => !c.unreadable).length)}
          detail="Readable on this device"
          icon={ShoppingBasket}
        />
        <Stat
          label="Running tab"
          value="—"
          detail="Open a group to see balances"
          icon={CircleDollarSign}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">Your groups</h2>
            <p className="text-sm text-muted-foreground">
              Only people you explicitly invite can see these lists.
            </p>
          </div>
          <button
            type="button"
            className="hidden shrink-0 text-sm text-primary hover:underline sm:block"
            onClick={() => setCreateOpen(true)}
            disabled={!shopping.unlocked}
          >
            New group
          </button>
        </div>
        {shopping.unlocked && !shopping.loading && cards.length === 0 && (
          <p className="text-sm text-muted-foreground">No shared lists yet. Create a group to start.</p>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => navigateTo("shopping-group", group.id)}
              className="group flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-5 text-left transition hover:border-primary/60 hover:bg-accent/50"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <ShoppingBasket className="size-5" />
                </div>
                <ChevronRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-lg font-semibold">
                  {group.unreadable ? "Unable to read this group" : group.name}
                </h3>
                <p className="truncate text-sm text-muted-foreground">
                  {group.unreadable
                    ? "The key on this device does not match."
                    : group.description || "No description"}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
                <div className="flex -space-x-2">
                  <span className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-secondary text-xs font-semibold">
                    {group.myInitials}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] text-muted-foreground">
                    {group.memberCount}
                  </span>
                </div>
                <span className="text-right text-xs text-muted-foreground">
                  {formatShoppingUpdatedAt(group.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="leading-6 text-muted-foreground">
          <strong className="text-foreground">Privacy note.</strong> Shared receipts and balances are
          visible to group members. Your envelopes, transactions, and account connections are never
          shared automatically.
        </p>
      </div>

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={onCreate}
        unlocked={shopping.unlocked}
      />
    </section>
  )
}

async function decryptGroupCard(group: ShoppingGroupSummary, privacyKey: Uint8Array): Promise<GroupCard> {
  try {
    const groupKey = unwrapCurrentGroupKey(group.wraps, group.keyVersion, privacyKey)
    const metaRaw = await decryptShoppingJson(
      group.encryptedMetadata,
      groupKey,
      shoppingAad({
        groupId: group.id,
        objectId: group.id,
        keyVersion: group.keyVersion,
        revision: 1,
        recordType: "group_metadata",
      }),
    )
    const meta = parseGroupMetadata(metaRaw)
    let myInitials = "Y"
    try {
      const aliasRaw = await decryptShoppingJson(
        group.myMember.encryptedAlias,
        groupKey,
        shoppingAad({
          groupId: group.id,
          objectId: group.myMember.localId,
          keyVersion: group.keyVersion,
          revision: 1,
          recordType: "member_alias",
        }),
      )
      myInitials = aliasInitials(parseMemberAlias(aliasRaw).alias)
    } catch {
      /* keep default */
    }
    return {
      id: group.id,
      name: meta.name,
      description: meta.description,
      updatedAt: group.updatedAt,
      memberCount: group.activeMemberCount ?? 1,
      myInitials,
      unreadable: false,
    }
  } catch {
    return {
      id: group.id,
      name: "Shared list",
      updatedAt: group.updatedAt,
      memberCount: group.activeMemberCount ?? 1,
      myInitials: "?",
      unreadable: true,
    }
  }
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Users
}) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-2xl border border-border/70 bg-card p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function CreateGroupDialog({
  open,
  onOpenChange,
  onCreate,
  unlocked,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string, description: string, alias: string) => Promise<void>
  unlocked: boolean
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [alias, setAlias] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = Boolean(name.trim() && alias.trim())

  const submit = useCallback(async () => {
    if (!ready || busy || !unlocked) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(name, description, alias.trim())
      setName("")
      setDescription("")
      setAlias("")
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create group")
    } finally {
      setBusy(false)
    }
  }, [ready, name, description, alias, busy, unlocked, onCreate, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,32rem)] rounded-2xl border-border bg-card"
        onKeyDown={(e) =>
          handleDialogEnterToPrimary(e, { disabled: busy || !ready, onPrimary: () => void submit() })
        }
      >
        <DialogHeader className="pr-10 text-left">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">New shared space</p>
          <DialogTitle className="text-2xl">Create a shopping group</DialogTitle>
          <DialogDescription>
            The name and optional description are encrypted before they leave this device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Group name
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Apartment groceries"
              maxLength={80}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Your name in this group
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. Sam"
              autoComplete="nickname"
              maxLength={80}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium" data-no-enter-submit="">
            Description
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group for? (optional)"
              className="min-h-24 resize-none"
              maxLength={280}
            />
          </label>
          <div className="flex items-start gap-3 rounded-xl bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
            You will invite people next. They only see this group — never your private budget.
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => void submit()} disabled={!ready || busy || !unlocked}>
            Create group <ArrowRight className="size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
