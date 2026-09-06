import { describe, expect, it } from "vitest"
import { evaluateTransactionIsolation, defaultSighashType, RDTS_MAINNET_EXPIRY_MTP, RDTS_TESTNET4_EXPIRY_MTP } from "@/lib/wallet/transaction-isolation"
import type { IsolationRequest, IsolationEvidenceValidator, IsolationProfile, ExclusiveInputEvidence, RdtsPolicy } from "@/lib/wallet/transaction-isolation"
import { buildOpReturn } from "@/lib/wallet/op-return"

const tips = {
  sha256d: { height: 120, hash: "ab".repeat(32), medianTimePast: 1700000000 },
  blake2b: { height: 115, hash: "cd".repeat(32), medianTimePast: 1819756799 },
}
const rdts: RdtsPolicy = { activationHeight: 100, expiresAtParentMedianTimePast: 1819756800, rejectingLineage: "blake2b", maxOpReturnScriptBytes: 83 }
const outpoint = { txid: "ef".repeat(32), vout: 1 }
const profile: IsolationProfile = { network: "mainnet", profileId: "profile-1", tips, rdts }
const exclusive: ExclusiveInputEvidence = { network: "mainnet", profileId: "profile-1", tips, outpoint, lineage: "blake2b", excludedLineage: "sha256d", basis: "independent-ancestry", rdtsDependencies: [] }
const profileToken = Object.freeze({})
const inputToken = Object.freeze({})
const request: IsolationRequest = {
  network: "mainnet", lineage: "blake2b", profileId: "profile-1",
  snapshots: { sha256d: { network: "mainnet", lineage: "sha256d", tip: tips.sha256d, status: "fresh", profileId: "profile-1" }, blake2b: { network: "mainnet", lineage: "blake2b", tip: tips.blake2b, status: "fresh", profileId: "profile-1" } },
  selectedInputs: [{ outpoint, lineage: "blake2b" }, { outpoint: { ...outpoint, vout: 2 }, lineage: "blake2b" }],
  outputs: [{ valueSats: BigInt(1), scriptHex: "51" }],
  profileEvidence: profileToken, exclusiveInputEvidence: [inputToken],
}

function contextFor(nextProfile = profile, nextEvidence: ExclusiveInputEvidence = { ...exclusive, network: nextProfile.network, tips: nextProfile.tips }) {
  const nextRequest: IsolationRequest = {
    ...request, network: nextProfile.network,
    snapshots: {
      sha256d: { network: nextProfile.network, lineage: "sha256d", tip: nextProfile.tips.sha256d, status: "fresh", profileId: "profile-1" },
      blake2b: { network: nextProfile.network, lineage: "blake2b", tip: nextProfile.tips.blake2b, status: "fresh", profileId: "profile-1" },
    },
  }
  const validator: IsolationEvidenceValidator = {
    resolveProfile: token => token === profileToken ? nextProfile : null,
    resolveExclusiveInput: token => token === inputToken ? nextEvidence : null,
  }
  return { request: nextRequest, validator }
}

function markerRequest(base: IsolationRequest): IsolationRequest {
  return { ...base, lineage: "sha256d", selectedInputs: [{ outpoint, lineage: "sha256d" }], exclusiveInputEvidence: [], outputs: [{ valueSats: BigInt(0), scriptHex: buildOpReturn("ab".repeat(81)).scriptHex }] }
}

const validator = contextFor().validator

describe("evidence-bound isolation policy, not an ancestry verifier", () => {
  it("names lineages independently of network and uses 0x21 on blake2b", () => {
    expect(defaultSighashType("blake2b")).toBe(0x21)
    expect(defaultSighashType("sha256d")).toBe(0x01)
    expect(evaluateTransactionIsolation(request, validator)).toMatchObject({ status: "isolated", reason: "exclusive-input", sighashType: 0x21, sighashTypes: [0x21, 0x21], scope: "policy-only" })
  })
  it("does not forbid an 80-byte payload on the rejecting lineage", () => {
    expect(evaluateTransactionIsolation({ ...request, outputs: [{ valueSats: BigInt(0), scriptHex: buildOpReturn("ab".repeat(80)).scriptHex }] }, validator).status).toBe("isolated")
  })
  it("one exclusive input suffices in a mixed selection", () => {
    expect(evaluateTransactionIsolation(request, validator).status).toBe("isolated")
    expect(evaluateTransactionIsolation({ ...request, selectedInputs: request.selectedInputs.slice(1) }, validator).status).toBe("unknown")
  })
  it("never trusts boolean flags, deserialized verified claims or absent evidence", () => {
    expect(evaluateTransactionIsolation(request).status).toBe("unknown")
    for (const evidence of [true, { verified: true, ...exclusive }, JSON.parse(JSON.stringify({ verified: true, ...exclusive })), null]) {
      expect(evaluateTransactionIsolation({ ...request, exclusiveInputEvidence: [evidence] }, validator).status).toBe("unknown")
    }
    expect(evaluateTransactionIsolation({ ...request, exclusiveInputEvidence: [] }, validator).status).toBe("unknown")
  })
  it("rejects evidence for another lineage, outpoint, network, profile or tip", () => {
    const mismatches = [{ lineage: "sha256d" as const }, { excludedLineage: "blake2b" as const }, { outpoint: { ...outpoint, vout: 99 } }, { network: "signet" as const }, { profileId: "other" }, { tips: { ...tips, blake2b: { ...tips.blake2b, hash: "11".repeat(32) } } }, { tips: { ...tips, blake2b: { ...tips.blake2b, medianTimePast: tips.blake2b.medianTimePast - 1 } } }]
    for (const mismatch of mismatches) {
      expect(evaluateTransactionIsolation(request, { ...validator, resolveExclusiveInput: () => ({ ...exclusive, ...mismatch }) }).status).toBe("unknown")
    }
  })
  it("fails closed on stale snapshots, validation failures or duplicate inputs", () => {
    expect(evaluateTransactionIsolation({ ...request, snapshots: { ...request.snapshots, blake2b: { ...request.snapshots.blake2b!, status: "stale" } } }, validator).status).toBe("unknown")
    expect(evaluateTransactionIsolation(request, { ...validator, resolveProfile: () => { throw new Error("not validated") } }).status).toBe("unknown")
    expect(evaluateTransactionIsolation({ ...request, selectedInputs: [request.selectedInputs[0], request.selectedInputs[0]] }, validator).status).toBe("unsafe")
  })
  it("rejects sparse or malformed signing requests rather than skipping missing entries", () => {
    for (const changed of [{ sighashTypes: new Array(2) }, { sighashTypes: null }, { selectedInputs: new Array(1) }, { outputs: new Array(1) }, { exclusiveInputEvidence: true }]) {
      expect(evaluateTransactionIsolation({ ...request, ...changed } as IsolationRequest, validator).status).toBe("unsafe")
    }
  })
  it("does not promote bare boolean or absent tokens even through a permissive resolver", () => {
    const permissive: IsolationEvidenceValidator = { resolveProfile: () => profile, resolveExclusiveInput: () => exclusive }
    for (const token of [undefined, null, true, false]) {
      expect(evaluateTransactionIsolation({ ...request, profileEvidence: token }, permissive).status).toBe("unknown")
      expect(evaluateTransactionIsolation({ ...request, exclusiveInputEvidence: [token] }, permissive).status).toBe("unknown")
    }
  })
  it("requires exact profiles and well-formed parent median time past at both tips", () => {
    for (const changed of [{ profileId: "other" }, { rdts: { ...rdts, activationHeight: 100.5 } }, { rdts: { ...rdts, expiresAtParentMedianTimePast: Number.MAX_SAFE_INTEGER + 1 } }, { tips: { ...tips, sha256d: { ...tips.sha256d, medianTimePast: -1 } } }, { tips: { ...tips, sha256d: { ...tips.sha256d, hash: "11".repeat(32) } } }]) {
      expect(evaluateTransactionIsolation(request, { ...validator, resolveProfile: () => ({ ...profile, ...changed }) }).status).toBe("unknown")
    }
  })
})

describe("all-input/output sighashes", () => {
  it.each([0x81, 0xa1, 2, 3, 0x22, 0x23, 0, 0x41])("rejects unsupported blake2b sighash %s", sighash => {
    expect(evaluateTransactionIsolation({ ...request, sighashTypes: [sighash, 0x21] }, validator).status).toBe("unsafe")
  })
  it.each([[0, 0], [1, 1], [0, 1], [1, 0]])("allows sha256d default/all combinations %s %s", (first, second) => {
    const shaEvidence: ExclusiveInputEvidence = { ...exclusive, lineage: "sha256d", excludedLineage: "blake2b" }
    const context = contextFor(profile, shaEvidence)
    const shaRequest: IsolationRequest = { ...context.request, lineage: "sha256d", selectedInputs: request.selectedInputs.map(input => ({ ...input, lineage: "sha256d" })), sighashTypes: [first, second] }
    expect(evaluateTransactionIsolation(shaRequest, context.validator)).toMatchObject({ status: "isolated", sighashTypes: [first, second], sighashType: first === second ? first : null })
  })
  it.each([0x80, 0x81, 0x82, 0x83, 2, 3, 0x21])("rejects sha256d ACP/NONE/SINGLE and unsupported modes %s", sighash => {
    const sha = markerRequest(request)
    expect(evaluateTransactionIsolation({ ...sha, sighashTypes: [sighash] }, validator).status).toBe("unsafe")
  })
  it("requires a mode for every selected input when explicitly supplied", () => {
    expect(evaluateTransactionIsolation({ ...request, sighashTypes: [0x21] }, validator).status).toBe("unsafe")
    expect(evaluateTransactionIsolation({ ...request, sighashTypes: [0x21, 0xa1] }, validator).status).toBe("unsafe")
  })
})

describe("RDTS activation and parent-MTP expiry", () => {
  it("uses the inspected mainnet and testnet4 expiry constants", () => {
    expect(RDTS_MAINNET_EXPIRY_MTP).toBe(1819756800)
    expect(RDTS_TESTNET4_EXPIRY_MTP).toBe(1791903600)
  })
  it.each(["mainnet", "testnet4"] as const)("expires exactly at the configured parent MTP on %s", network => {
    const expiry = network === "mainnet" ? 1819756800 : 1791903600
    for (const delta of [-1, 0, 1]) {
      const nextProfile: IsolationProfile = { ...profile, network, rdts: { ...rdts, expiresAtParentMedianTimePast: expiry }, tips: { ...tips, blake2b: { ...tips.blake2b, medianTimePast: expiry + delta } } }
      const context = contextFor(nextProfile)
      expect(evaluateTransactionIsolation(markerRequest(context.request), context.validator).status).toBe(delta < 0 ? "isolated" : "unknown")
    }
  })
  it.each([98, 99, 100, 1000000])("evaluates next-block activation without an end-height expiry at tip %s", height => {
    const context = contextFor({ ...profile, tips: { ...tips, blake2b: { ...tips.blake2b, height } } })
    expect(evaluateTransactionIsolation(markerRequest(context.request), context.validator).status).toBe(height + 1 < 100 ? "unknown" : "isolated")
  })
  it("does not overflow the next candidate height", () => {
    const context = contextFor({ ...profile, tips: { ...tips, blake2b: { ...tips.blake2b, height: Number.MAX_SAFE_INTEGER } } })
    expect(evaluateTransactionIsolation(markerRequest(context.request), context.validator).status).toBe("unknown")
  })
  it("does not reject target marker outputs after the RDTS restriction expires", () => {
    const context = contextFor({ ...profile, tips: { ...tips, blake2b: { ...tips.blake2b, medianTimePast: rdts.expiresAtParentMedianTimePast } } })
    expect(evaluateTransactionIsolation({ ...context.request, outputs: markerRequest(request).outputs }, context.validator).status).toBe("isolated")
  })
  it("only recognizes a canonical 84-byte marker with a validated applicable RDTS profile", () => {
    const sha = markerRequest(request)
    expect(evaluateTransactionIsolation(sha, validator)).toMatchObject({ status: "isolated", reason: "rdts-marker" })
    expect(evaluateTransactionIsolation(sha).status).toBe("unknown")
    expect(evaluateTransactionIsolation({ ...sha, profileEvidence: { verified: true, ...profile } }, validator).status).toBe("unknown")
    expect(evaluateTransactionIsolation({ ...sha, outputs: [{ valueSats: BigInt(0), scriptHex: buildOpReturn("ab".repeat(80)).scriptHex }] }, validator).status).toBe("unknown")
    expect(evaluateTransactionIsolation({ ...request, outputs: sha.outputs }, validator).status).toBe("unsafe")
    const inactive = contextFor({ ...profile, rdts: null })
    expect(evaluateTransactionIsolation(markerRequest(inactive.request), inactive.validator).status).toBe("unknown")
  })
})

describe("independent exclusion versus expiring RDTS ancestry", () => {
  it.each(["independent-ancestry", "conflicting-spend"] as const)("keeps genuinely independent %s usable without active RDTS", basis => {
    for (const nextProfile of [{ ...profile, rdts: null }, { ...profile, tips: { ...tips, blake2b: { ...tips.blake2b, height: 98 } } }, { ...profile, tips: { ...tips, blake2b: { ...tips.blake2b, medianTimePast: rdts.expiresAtParentMedianTimePast } } }]) {
      const context = contextFor(nextProfile, { ...exclusive, basis, tips: nextProfile.tips })
      expect(evaluateTransactionIsolation(context.request, context.validator)).toMatchObject({ status: "isolated", reason: "exclusive-input" })
    }
  })
  it.each(["rdts-ancestor", "independent-ancestry", "conflicting-spend"] as const)("retains an RDTS dependency expiry even when the evidence basis is %s", basis => {
    for (const delta of [-1, 0, 1]) {
      const nextProfile = { ...profile, tips: { ...tips, blake2b: { ...tips.blake2b, medianTimePast: rdts.expiresAtParentMedianTimePast + delta } } }
      const evidence: ExclusiveInputEvidence = { ...exclusive, lineage: "sha256d", excludedLineage: "blake2b", tips: nextProfile.tips, basis, rdtsDependencies: [rdts] }
      const context = contextFor(nextProfile, evidence)
      const sha: IsolationRequest = { ...context.request, lineage: "sha256d", selectedInputs: [{ outpoint, lineage: "sha256d" }] }
      expect(evaluateTransactionIsolation(sha, context.validator).status).toBe(delta < 0 ? "isolated" : "unknown")
    }
  })
  it("never treats absent or malformed dependency declarations as independence", () => {
    const changes = [{ rdtsDependencies: undefined }, { rdtsDependencies: null }, { rdtsDependencies: true }, { rdtsDependencies: new Array(1) }, { basis: "rdts-ancestor", rdtsDependencies: [] }, { basis: "verified" }]
    for (const change of changes) {
      const evidence = { ...exclusive, ...change } as ExclusiveInputEvidence
      expect(evaluateTransactionIsolation(request, contextFor(profile, evidence).validator).status).toBe("unknown")
    }
  })
  it("requires temporary dependencies to match the validated RDTS policy and excluding lineage", () => {
    for (const dependency of [{ ...rdts, activationHeight: 99 }, { ...rdts, expiresAtParentMedianTimePast: rdts.expiresAtParentMedianTimePast + 1 }]) {
      const evidence: ExclusiveInputEvidence = { ...exclusive, lineage: "sha256d", excludedLineage: "blake2b", basis: "rdts-ancestor", rdtsDependencies: [dependency] }
      const sha: IsolationRequest = { ...request, lineage: "sha256d", selectedInputs: [{ outpoint, lineage: "sha256d" }] }
      expect(evaluateTransactionIsolation(sha, contextFor(profile, evidence).validator).status).toBe("unknown")
    }
    const wrongLineage: ExclusiveInputEvidence = { ...exclusive, basis: "rdts-ancestor", rdtsDependencies: [rdts] }
    expect(evaluateTransactionIsolation(request, contextFor(profile, wrongLineage).validator).status).toBe("unknown")
  })
})
