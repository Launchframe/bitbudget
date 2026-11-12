import { isRdtsMarkerScript } from "@/lib/wallet/op-return"
import { hexToBytes } from "@/lib/wallet/public-data-tools"
import { BITCOIN_LINEAGES, isBitcoinLineage, isBitcoinNetwork, isChainTip, isNonnegativeSafeInteger, outpointKey, sameChainTip } from "@/lib/wallet/types"
import type { BitcoinLineage, BitcoinNetwork, ChainSnapshots, ChainTip, Outpoint } from "@/lib/wallet/types"

export const RDTS_MAINNET_EXPIRY_MTP = 1819756800
export const RDTS_TESTNET4_EXPIRY_MTP = 1791903600

export interface RdtsPolicy {
  readonly activationHeight: number
  readonly expiresAtParentMedianTimePast: number
  readonly rejectingLineage: "blake2b"
  readonly maxOpReturnScriptBytes: 83
}

export interface IsolationProfile {
  readonly network: BitcoinNetwork
  readonly profileId: string
  readonly tips: Readonly<Record<BitcoinLineage, ChainTip>>
  readonly rdts: RdtsPolicy | null
}

export interface ExclusiveInputEvidence {
  readonly network: BitcoinNetwork
  readonly profileId: string
  readonly tips: Readonly<Record<BitcoinLineage, ChainTip>>
  readonly outpoint: Outpoint
  readonly lineage: BitcoinLineage
  readonly excludedLineage: BitcoinLineage
  readonly basis: "independent-ancestry" | "conflicting-spend" | "rdts-ancestor"
  readonly rdtsDependencies: readonly RdtsPolicy[]
}

export interface IsolationEvidenceValidator {
  readonly resolveProfile: (evidence: unknown) => IsolationProfile | null
  readonly resolveExclusiveInput: (evidence: unknown) => ExclusiveInputEvidence | null
}

export interface IsolationRequest {
  readonly network: BitcoinNetwork
  readonly lineage: BitcoinLineage
  readonly profileId: string
  readonly snapshots: ChainSnapshots
  readonly selectedInputs: readonly { readonly outpoint: Outpoint; readonly lineage: BitcoinLineage }[]
  readonly outputs: readonly { readonly valueSats: bigint; readonly scriptHex: string }[]
  readonly sighashTypes?: readonly number[]
  readonly profileEvidence?: unknown
  readonly exclusiveInputEvidence?: readonly unknown[]
}

export interface IsolationDecision {
  readonly status: "isolated" | "unknown" | "unsafe"
  readonly reason: "exclusive-input" | "rdts-marker" | "invalid-request" | "unsupported-sighash" | "unvalidated-profile" | "stale-or-mismatched-profile" | "missing-exclusive-evidence" | "marker-rejected-on-target"
  readonly sighashType: number | null
  readonly sighashTypes: readonly number[]
  readonly scope: "policy-only"
}

export function defaultSighashType(lineage: BitcoinLineage): number {
  if (!isBitcoinLineage(lineage)) throw new Error("Unknown Bitcoin lineage")
  return lineage === "blake2b" ? 0x21 : 0x01
}

function validRdtsPolicy(policy: RdtsPolicy | null | undefined): policy is RdtsPolicy {
  return !!policy && isNonnegativeSafeInteger(policy.activationHeight) && isNonnegativeSafeInteger(policy.expiresAtParentMedianTimePast) && policy.rejectingLineage === "blake2b" && policy.maxOpReturnScriptBytes === 83
}

export function isRdtsApplicable(policy: RdtsPolicy | null, tip: ChainTip): boolean {
  return validRdtsPolicy(policy) && isChainTip(tip) && isNonnegativeSafeInteger(tip.height + 1) && tip.height + 1 >= policy.activationHeight && tip.medianTimePast < policy.expiresAtParentMedianTimePast
}

function profileMatches(profile: IsolationProfile, request: IsolationRequest): boolean {
  if (profile.network !== request.network || profile.profileId !== request.profileId || (profile.rdts !== null && !validRdtsPolicy(profile.rdts))) return false
  for (const lineage of BITCOIN_LINEAGES) {
    const snapshot = request.snapshots[lineage]
    if (!snapshot || snapshot.status !== "fresh" || snapshot.network !== request.network || snapshot.lineage !== lineage || snapshot.profileId !== profile.profileId || !sameChainTip(snapshot.tip, profile.tips?.[lineage])) return false
  }
  return true
}

function exclusiveInputMatches(evidence: ExclusiveInputEvidence, profile: IsolationProfile, request: IsolationRequest, selectedOutpoints: ReadonlySet<string>): boolean {
  if (evidence.network !== request.network || evidence.lineage !== request.lineage || evidence.profileId !== profile.profileId || evidence.excludedLineage !== (request.lineage === "blake2b" ? "sha256d" : "blake2b")) return false
  if (!BITCOIN_LINEAGES.every(lineage => sameChainTip(evidence.tips?.[lineage], profile.tips[lineage]))) return false
  if (evidence.basis !== "independent-ancestry" && evidence.basis !== "conflicting-spend" && evidence.basis !== "rdts-ancestor") return false
  if (!Array.isArray(evidence.rdtsDependencies) || (evidence.basis === "rdts-ancestor" && !evidence.rdtsDependencies.length)) return false
  for (const dependency of evidence.rdtsDependencies) {
    if (!validRdtsPolicy(dependency) || !profile.rdts || dependency.rejectingLineage !== evidence.excludedLineage || dependency.activationHeight !== profile.rdts.activationHeight || dependency.expiresAtParentMedianTimePast !== profile.rdts.expiresAtParentMedianTimePast || dependency.rejectingLineage !== profile.rdts.rejectingLineage || dependency.maxOpReturnScriptBytes !== profile.rdts.maxOpReturnScriptBytes || !isRdtsApplicable(dependency, profile.tips[dependency.rejectingLineage])) return false
  }
  return selectedOutpoints.has(outpointKey(evidence.outpoint))
}

export function evaluateTransactionIsolation(request: IsolationRequest, validator?: IsolationEvidenceValidator): IsolationDecision {
  let sighashType: number | null = null
  let sighashTypes: number[] = []
  const decision = (status: IsolationDecision["status"], reason: IsolationDecision["reason"]): IsolationDecision => ({ status, reason, sighashType, sighashTypes, scope: "policy-only" })
  let selectedOutpoints: Set<string>
  let outputScripts: Uint8Array[]
  try {
    if (!isBitcoinNetwork(request.network) || !isBitcoinLineage(request.lineage) || typeof request.profileId !== "string" || !request.profileId.trim() || !Array.isArray(request.selectedInputs) || !request.selectedInputs.length || !Array.isArray(request.outputs) || !request.outputs.length) return decision("unsafe", "invalid-request")
    if (request.exclusiveInputEvidence !== undefined && !Array.isArray(request.exclusiveInputEvidence)) return decision("unsafe", "invalid-request")
    selectedOutpoints = new Set(Array.from(request.selectedInputs, input => {
      if (input.lineage !== request.lineage) throw new Error("Input lineage mismatch")
      return outpointKey(input.outpoint)
    }))
    if (selectedOutpoints.size !== request.selectedInputs.length) return decision("unsafe", "invalid-request")
    const sighashes = request.sighashTypes === undefined ? request.selectedInputs.map(() => defaultSighashType(request.lineage)) : request.sighashTypes
    if (!Array.isArray(sighashes) || sighashes.length !== request.selectedInputs.length || Array.from(sighashes).some(type => request.lineage === "sha256d" ? type !== 0x00 && type !== 0x01 : type !== 0x21)) return decision("unsafe", "unsupported-sighash")
    sighashTypes = Array.from(sighashes)
    sighashType = sighashTypes.every(type => type === sighashTypes[0]) ? sighashTypes[0] : null
    outputScripts = Array.from(request.outputs, output => {
      if (typeof output.valueSats !== "bigint" || output.valueSats < BigInt(0)) throw new Error("Invalid output amount")
      const bytes = hexToBytes(output.scriptHex)
      if (!bytes.length) throw new Error("Empty output script is not supported")
      return bytes
    })
  } catch {
    return decision("unsafe", "invalid-request")
  }
  if (request.profileEvidence == null || typeof request.profileEvidence === "boolean" || !validator || typeof validator.resolveProfile !== "function" || typeof validator.resolveExclusiveInput !== "function") return decision("unknown", "unvalidated-profile")
  let profile: IsolationProfile | null
  try {
    profile = validator.resolveProfile(request.profileEvidence)
    if (!profile) return decision("unknown", "unvalidated-profile")
    if (!profileMatches(profile, request)) return decision("unknown", "stale-or-mismatched-profile")
  } catch {
    return decision("unknown", "unvalidated-profile")
  }
  const activeRdts = profile.rdts && isRdtsApplicable(profile.rdts, profile.tips[profile.rdts.rejectingLineage]) ? profile.rdts : null
  if (activeRdts && request.lineage === activeRdts.rejectingLineage && outputScripts.some(script => script[0] === 0x6a && script.length > activeRdts.maxOpReturnScriptBytes)) return decision("unsafe", "marker-rejected-on-target")
  for (const token of request.exclusiveInputEvidence ?? []) {
    if (token == null || typeof token === "boolean") continue
    try {
      const evidence = validator.resolveExclusiveInput(token)
      if (evidence && exclusiveInputMatches(evidence, profile, request, selectedOutpoints)) return decision("isolated", "exclusive-input")
    } catch {
      continue
    }
  }
  if (activeRdts && request.lineage !== activeRdts.rejectingLineage && request.outputs.some(output => isRdtsMarkerScript(output.scriptHex))) return decision("isolated", "rdts-marker")
  return decision("unknown", "missing-exclusive-evidence")
}
