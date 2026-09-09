import { describe, expect, it, vi } from "vitest"
import { BITCOIN_MAINNET_GENESIS, checkMainnetGenesis, testElectrumConnection } from "@/lib/wallet/chain/electrum-diagnostics"
import type { ElectrumClient } from "@/lib/wallet/chain/electrum-client"

const header = `01000000${"00".repeat(32)}3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c`

describe("read-only Electrum diagnostics", () => {
  it("hashes the actual genesis header rather than trusting a server network label", () => {
    expect(checkMainnetGenesis(header, BITCOIN_MAINNET_GENESIS)).toBe(BITCOIN_MAINNET_GENESIS)
    expect(() => checkMainnetGenesis("00".repeat(80), BITCOIN_MAINNET_GENESIS)).toThrow("genesis-mismatch")
    expect(() => checkMainnetGenesis(header, "00".repeat(32))).toThrow("genesis-mismatch")
    expect(() => checkMainnetGenesis(header, null)).toThrow()
    expect(() => checkMainnetGenesis("00", BITCOIN_MAINNET_GENESIS)).toThrow("invalid-genesis-header")
  })

  it("requests public metadata only and never marks the chain consensus-verified", async () => {
    const probe = { observedGenesisHash: BITCOIN_MAINNET_GENESIS, observedHeaderBytes: 80, observedHeight: 1, verification: "needs-consensus-verification" }
    const client = { probeCapabilities: vi.fn(async () => probe), request: vi.fn(async () => header) }
    const result = await testElectrumConnection(client as unknown as ElectrumClient)
    expect(result).toMatchObject({ readOnly: true, consensusVerified: false, mainnetGenesisMatches: true })
    expect(client.request).toHaveBeenCalledExactlyOnceWith("blockchain.block.header", [0], undefined)
    client.probeCapabilities.mockResolvedValue({ ...probe, observedHeaderBytes: 1 })
    await expect(testElectrumConnection(client as unknown as ElectrumClient)).rejects.toThrow("invalid-tip-header")
  })
})
