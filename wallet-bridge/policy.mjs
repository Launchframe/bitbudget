import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

const canonicalPolicyFile = join(homedir(), ".config", "devin", "bitbudget-electrum-bridge-policy.json")
const emptyPolicy = Object.freeze({ version: 1, denySocks: false, denyOnion: false })
const messages = Object.freeze({
  ERR_BRIDGE_POLICY_INVALID: "Bridge policy is missing, unreadable, or invalid",
  ERR_BRIDGE_SOCKS_DENIED: "SOCKS routing is denied by local bridge policy",
  ERR_BRIDGE_ONION_DENIED: "Onion routing is denied by local bridge policy",
})

export class BridgePolicyError extends Error {
  constructor(code) {
    super(messages[code] ?? messages.ERR_BRIDGE_POLICY_INVALID)
    this.name = "BridgePolicyError"
    this.code = Object.hasOwn(messages, code) ? code : "ERR_BRIDGE_POLICY_INVALID"
  }
}

export function parsePolicy(text) {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > 4096) throw new Error()
    const value = JSON.parse(text)
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "denyOnion,denySocks,version" || value.version !== 1 || typeof value.denySocks !== "boolean" || typeof value.denyOnion !== "boolean") throw new Error()
    return Object.freeze({ version: 1, denySocks: value.denySocks, denyOnion: value.denyOnion })
  } catch { throw new BridgePolicyError("ERR_BRIDGE_POLICY_INVALID") }
}

export function readPolicyFile(file, optional = false) {
  let descriptor
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    if (!fstatSync(descriptor).isFile()) throw new Error()
    const bytes = Buffer.alloc(4097)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    return parsePolicy(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)))
  } catch (error) {
    if (optional && descriptor === undefined && error?.code === "ENOENT") {
      try { lstatSync(file) } catch (missing) { if (missing?.code === "ENOENT") return emptyPolicy }
    }
    throw new BridgePolicyError("ERR_BRIDGE_POLICY_INVALID")
  } finally { if (descriptor !== undefined) closeSync(descriptor) }
}

export function mergePolicies(...policies) {
  return Object.freeze({ version: 1, denySocks: policies.some(policy => policy.denySocks), denyOnion: policies.some(policy => policy.denyOnion) })
}

function policySources(policyFile) {
  const sources = new Map([[canonicalPolicyFile, true]])
  for (const file of [process.env.BITBUDGET_BRIDGE_POLICY_FILE, policyFile]) {
    if (file === undefined) continue
    if (typeof file !== "string" || !file.trim() || file.includes("\0")) throw new BridgePolicyError("ERR_BRIDGE_POLICY_INVALID")
    sources.set(isAbsolute(file) ? file : resolve(file), false)
  }
  return [...sources]
}

export function readMachinePolicy(policyFile) {
  return mergePolicies(...policySources(policyFile).map(([file, optional]) => readPolicyFile(file, optional)))
}

export function assertRoutingAllowed(policy, config) {
  if (policy.denySocks && config.socksProxy !== undefined && config.socksProxy !== null) throw new BridgePolicyError("ERR_BRIDGE_SOCKS_DENIED")
  if (policy.denyOnion && [config.upstreamHost, config.upstreamServername].some(host => typeof host === "string" && host.toLowerCase().replace(/\.+$/, "").endsWith(".onion"))) throw new BridgePolicyError("ERR_BRIDGE_ONION_DENIED")
}

export function createPolicyGuard(config) {
  const sources = policySources(config.policyFile)
  let policy = emptyPolicy
  return () => {
    policy = mergePolicies(policy, ...sources.map(([file, optional]) => readPolicyFile(file, optional)))
    assertRoutingAllowed(policy, config)
  }
}
