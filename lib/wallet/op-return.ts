import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"

export const RDTS_MIN_PAYLOAD_BYTES = 81
export const RDTS_MIN_SCRIPT_BYTES = 84

export interface OpReturnData {
  readonly payloadHex: string
  readonly scriptHex: string
  readonly payloadBytes: number
  readonly scriptBytes: number
}

export function buildOpReturn(payloadHex: string): OpReturnData {
  const payload = hexToBytes(payloadHex)
  const size = payload.length
  if (size > 0xffffffff) throw new Error("Payload exceeds the script push encoding limit")
  let prefix: number[]
  let data = payload
  if (size === 1 && ((payload[0] >= 1 && payload[0] <= 16) || payload[0] === 0x81)) {
    prefix = [0x6a, payload[0] === 0x81 ? 0x4f : 0x50 + payload[0]]
    data = new Uint8Array()
  } else if (size <= 75) {
    prefix = [0x6a, size]
  } else if (size <= 255) {
    prefix = [0x6a, 0x4c, size]
  } else if (size <= 65535) {
    prefix = [0x6a, 0x4d, size & 0xff, (size >>> 8) & 0xff]
  } else {
    prefix = [0x6a, 0x4e, size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff]
  }
  const script = new Uint8Array(prefix.length + data.length)
  script.set(prefix)
  script.set(data, prefix.length)
  return { payloadHex: bytesToHex(payload), scriptHex: bytesToHex(script), payloadBytes: size, scriptBytes: script.length }
}

export function isRdtsMarkerScript(scriptHex: string): boolean {
  try {
    const script = hexToBytes(scriptHex)
    if (script[0] !== 0x6a || script.length < RDTS_MIN_SCRIPT_BYTES) return false
    let offset: number
    let size: number
    if (script[1] === 0x4c) {
      offset = 3
      size = script[2]
    } else if (script[1] === 0x4d) {
      offset = 4
      size = script[2] + script[3] * 256
    } else if (script[1] === 0x4e) {
      offset = 6
      size = script[2] + script[3] * 256 + script[4] * 65536 + script[5] * 16777216
    } else {
      return false
    }
    return size >= RDTS_MIN_PAYLOAD_BYTES && script.length === offset + size && buildOpReturn(bytesToHex(script.slice(offset))).scriptHex === scriptHex.toLowerCase()
  } catch {
    return false
  }
}

export function padApprovedPublicData<T extends { readonly payloadHex: string }>(
  data: T,
  approval: { readonly publicDataApproved: boolean; readonly paddingApproved: boolean },
): T {
  if (approval?.publicDataApproved !== true || approval?.paddingApproved !== true) throw new Error("Explicit public-data and padding approval is required")
  const bytes = hexToBytes(data.payloadHex)
  if (bytes.length >= RDTS_MIN_PAYLOAD_BYTES) return { ...data }
  const padding = "00".repeat(RDTS_MIN_PAYLOAD_BYTES - bytes.length)
  return { ...data, payloadHex: data.payloadHex + padding }
}
