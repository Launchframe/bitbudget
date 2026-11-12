import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"
import { ElectrumClient, type ElectrumProbe } from "@/lib/wallet/chain/electrum-client"

export const BITCOIN_MAINNET_GENESIS = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"

export interface ElectrumConnectionDiagnostic {
  probe: ElectrumProbe
  genesisHeaderHash: string
  mainnetGenesisMatches: true
  consensusVerified: false
  readOnly: true
}

export function checkMainnetGenesis(header: unknown, reportedHash: string | null): string {
  if (typeof header !== "string" || !/^[a-fA-F0-9]{160}$/.test(header)) throw new Error("invalid-genesis-header")
  const hash = bytesToHex(sha256(sha256(hexToBytes(header))).reverse())
  if (hash !== BITCOIN_MAINNET_GENESIS || reportedHash !== hash) throw new Error("genesis-mismatch")
  return hash
}

export async function testElectrumConnection(client: ElectrumClient, signal?: AbortSignal): Promise<ElectrumConnectionDiagnostic> {
  const [probe, genesis] = await Promise.all([client.probeCapabilities(signal), client.request("blockchain.block.header", [0], signal)])
  const genesisHeaderHash = checkMainnetGenesis(genesis, probe.observedGenesisHash)
  if (probe.observedHeaderBytes !== 80 || probe.observedHeight === null) throw new Error("invalid-tip-header")
  return { probe, genesisHeaderHash, mainnetGenesisMatches: true, consensusVerified: false, readOnly: true }
}
