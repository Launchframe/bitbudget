"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ElectrumClient, ElectrumError } from "@/lib/wallet/chain/electrum-client"
import { ConnectionUrlError } from "@/lib/wallet/chain/connection-url"
import { testElectrumConnection, type ElectrumConnectionDiagnostic } from "@/lib/wallet/chain/electrum-diagnostics"

export default function ElectrumConnectionTest() {
  const [url, setUrl] = useState(process.env.NODE_ENV === "development" ? "ws://127.0.0.1:50004/electrum" : "")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ElectrumConnectionDiagnostic | null>(null)
  const [error, setError] = useState("")
  const client = useRef<ElectrumClient | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; client.current?.dispose() }, [])

  function cancel() {
    generation.current++
    client.current?.dispose()
    client.current = null
    setBusy(false)
  }

  async function connect() {
    const current = ++generation.current
    client.current?.dispose()
    setBusy(true); setError(""); setResult(null)
    let connection: ElectrumClient | null = null
    try {
      connection = new ElectrumClient({ url, allowLoopbackDevelopment: process.env.NODE_ENV === "development", timeoutMs: 60000 })
      client.current = connection
      const diagnostic = await testElectrumConnection(connection)
      if (generation.current === current) setResult(diagnostic)
    } catch (error) {
      if (generation.current !== current) return
      setError(error instanceof ConnectionUrlError || (error instanceof ElectrumError && error.code === "unsupported-transport") ? "Use a WSS bridge URL without credentials. Raw ssl:// and tcp:// Electrum addresses cannot be opened by a browser. Loopback ws:// is allowed only in local development." :
        error instanceof ElectrumError ? "Could not test the bridge. Check that it is running, permits this browser origin, trusts the Electrum TLS certificate and hostname, and has a working Tor proxy if using an onion endpoint." :
          "The response did not pass the Bitcoin mainnet genesis/header checks. Do not treat this connection as verified.")
    } finally {
      connection?.dispose()
      if (generation.current === current) { setBusy(false); client.current = null }
    }
  }

  return <div className="mt-4 space-y-3" data-electrum-connection-test="true">
    <h3 className="font-medium">Test an Electrum bridge</h3>
    <p className="text-sm text-muted-foreground">This read-only test requests server information and public block headers only. It sends no wallet addresses, keys or transactions. Future wallet queries can reveal script hashes to your bridge and indexer.</p>
    <div><Label htmlFor="electrum-bridge-url">Electrum bridge URL</Label><Input id="electrum-bridge-url" value={url} disabled={busy} maxLength={2048} autoComplete="off" spellCheck={false} placeholder="wss://your-bridge/electrum" className="mt-2" onChange={event => { setUrl(event.target.value); setError(""); setResult(null) }} /></div>
    {process.env.NODE_ENV === "development" ? <p className="text-xs text-amber-200">Local development may use ws://127.0.0.1 on this Mac. That loopback link is unencrypted; upstream Electrum TLS must still be verified. Production requires WSS.</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || !url} onClick={() => { void connect() }}>{busy ? "Testing connection…" : "Test read-only connection"}</Button>{busy ? <Button type="button" variant="ghost" onClick={cancel}>Cancel test</Button> : null}</div>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    {result ? <div role="status" className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <p className="font-medium">Connection test passed · read-only</p>
      <p>Server: {result.probe.observedServerVersion ?? "Not reported"}</p>
      <p>Reported tip height: {result.probe.observedHeight?.toLocaleString()}</p>
      <p>Bitcoin mainnet genesis header matches the expected hash.</p>
      <p className="text-amber-200">This does not verify chain work, fork lineage, balances or replay protection. The test connection is now closed.</p>
    </div> : null}
    <p className="text-xs text-muted-foreground">The URL is not saved. This test does not enable wallet creation, receiving or broadcasting, and does not use Bitcoin Core RPC credentials.</p>
  </div>
}
