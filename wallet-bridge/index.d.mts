import type { Buffer } from "node:buffer"
import type { AddressInfo } from "node:net"

export type BridgePolicyErrorCode = "ERR_BRIDGE_POLICY_INVALID" | "ERR_BRIDGE_SOCKS_DENIED" | "ERR_BRIDGE_ONION_DENIED"

export declare class BridgePolicyError extends Error {
  readonly code: BridgePolicyErrorCode
  constructor(code: BridgePolicyErrorCode)
}

export interface SocksProxy {
  readonly host: string
  readonly port: number
}

export interface BridgeCommonConfig {
  readonly port: number
  readonly upstreamHost: string
  readonly upstreamPort: number
  readonly upstreamServername: string
  readonly upstreamCa?: string | Buffer | readonly (string | Buffer)[]
  readonly allowedOrigins: readonly string[]
  readonly socksProxy?: SocksProxy
  readonly timeoutMs?: number
  readonly policyFile?: string
}

export type BridgeConfig = BridgeCommonConfig & (
  | { readonly mode: "loopback-development"; readonly host: "127.0.0.1" | "::1" }
  | { readonly mode: "tls"; readonly host: "127.0.0.1" | "::1" | "0.0.0.0"; readonly tlsKey: string | Buffer; readonly tlsCert: string | Buffer; readonly allowedHosts: readonly string[] }
)

export interface ElectrumBridge {
  listen(): Promise<AddressInfo>
  close(): Promise<void>
}

export declare function createElectrumBridge(config: BridgeConfig): ElectrumBridge
