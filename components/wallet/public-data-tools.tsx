"use client"

import { useMemo, useState } from "react"
import { Copy, Fingerprint, RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { buildOpReturn, padApprovedPublicData } from "@/lib/wallet/op-return"
import { hexToBytes, sha256Hex, utf8ToHex } from "@/lib/wallet/public-data-tools"

export default function PublicDataTools() {
  const [mode, setMode] = useState<"text" | "hex">("text")
  const [input, setInput] = useState("")
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [pad, setPad] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [resetOpen, setResetOpen] = useState(false)
  const preview = useMemo(() => {
    try {
      const sourceHex = mode === "text" ? utf8ToHex(input) : input
      const sourceBytes = hexToBytes(sourceHex).length
      const payloadHex = fingerprint ?? sourceHex
      const payload = pad ? padApprovedPublicData({ payloadHex }, { publicDataApproved: true, paddingApproved: true }).payloadHex : payloadHex
      return { sourceHex, sourceBytes, output: buildOpReturn(payload), error: null }
    } catch {
      return { sourceHex: "", sourceBytes: 0, output: null, error: "Enter complete hexadecimal bytes without spaces or a prefix, or valid text." }
    }
  }, [input, mode, fingerprint, pad])

  function changeInput(value: string) {
    setInput(value)
    setFingerprint(null)
    setNotice("")
  }

  async function hash() {
    if (preview.error || busy) return
    setBusy(true)
    setNotice("")
    try {
      setFingerprint(await sha256Hex(preview.sourceHex))
    } catch {
      setNotice("Your browser could not calculate the fingerprint.")
    } finally {
      setBusy(false)
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice("Copied.")
    } catch {
      setNotice("Copy is unavailable. Select the value and copy it manually.")
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6" aria-labelledby="public-data-title">
      <h2 id="public-data-title" className="text-lg font-semibold">Public data tools</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Convert text to bytes or calculate a SHA-256 fingerprint entirely in your browser. Nothing here is uploaded, saved or broadcast.</p>
      <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">If embedded in a transaction, this data is public and permanent. A fingerprint is not encryption; predictable inputs can still be guessed.</p>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Input encoding">
        {(["text", "hex"] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setFingerprint(null); setNotice("") }} className={`rounded-full border px-4 py-2 text-sm ${mode === value ? "border-[#F7931A] text-[#F7931A]" : "border-border text-muted-foreground"}`}>{value === "text" ? "UTF-8 text" : "Hex bytes"}</button>)}
      </div>
      <Label htmlFor="wallet-public-input" className="mt-5 block">{mode === "text" ? "Text to convert" : "Hexadecimal bytes"}</Label>
      <Textarea id="wallet-public-input" value={input} onChange={event => changeInput(event.target.value)} disabled={busy} maxLength={8192} className="mt-2 min-h-28 font-mono" autoComplete="off" spellCheck={false} />
      {preview.error ? <p role="alert" className="mt-2 text-sm text-red-300">{preview.error}</p> : <p className="mt-2 text-xs text-muted-foreground">{preview.sourceBytes} input bytes</p>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => { void hash() }} disabled={busy || Boolean(preview.error)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"><Fingerprint className="h-4 w-4" aria-hidden />{busy ? "Calculating…" : "Use SHA-256 fingerprint"}</button>
        <button type="button" disabled={busy || (!input && !fingerprint && !pad)} onClick={() => setResetOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm"><RotateCcw className="h-4 w-4" aria-hidden />Clear local input</button>
      </div>
      {fingerprint ? <div className="mt-4"><Label htmlFor="wallet-fingerprint">SHA-256 fingerprint (32 bytes)</Label><Input id="wallet-fingerprint" value={fingerprint} readOnly className="mt-2 font-mono" /></div> : null}
      <div className="mt-5 flex items-start justify-between gap-4">
        <div><Label htmlFor="wallet-pad-data">Preview padding to 81 bytes</Label><p id="wallet-pad-description" className="mt-1 text-xs leading-relaxed text-muted-foreground">Explicitly add zero bytes to shorter data. An 81-byte payload produces an 84-byte OP_RETURN script. This byte preview alone does not verify replay protection or chain rules.</p></div>
        <Switch id="wallet-pad-data" aria-describedby="wallet-pad-description" checked={pad} onCheckedChange={setPad} disabled={busy} />
      </div>
      {preview.output ? <div className="mt-5 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">{preview.output.payloadBytes} payload bytes · {preview.output.scriptBytes} script bytes</p>
        <div className="flex items-center justify-between gap-2"><Label htmlFor="wallet-script-preview">OP_RETURN script preview</Label><button type="button" onClick={() => { void copy(preview.output!.scriptHex) }} className="inline-flex items-center gap-1.5 text-sm text-[#F7931A]"><Copy className="h-4 w-4" aria-hidden />Copy script</button></div>
        <Textarea id="wallet-script-preview" value={preview.output.scriptHex} readOnly className="min-h-24 break-all font-mono" />
      </div> : null}
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-muted-foreground">{notice}</p>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear local input?</AlertDialogTitle>
            <AlertDialogDescription>This clears the text, fingerprint and padding preview from this browser tab. It does not delete wallet data or broadcast a transaction.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep input</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setInput(""); setFingerprint(null); setPad(false); setNotice("") }}>Clear input</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
