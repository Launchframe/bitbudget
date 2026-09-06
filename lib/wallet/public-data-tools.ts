export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Expected complete hexadecimal bytes without a prefix or spaces")
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new Error("Expected bytes")
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

export function utf8ToHex(text: string): string {
  if (typeof text !== "string") throw new Error("Expected text")
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Unpaired UTF16 surrogate")
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("Unpaired UTF16 surrogate")
    }
  }
  return bytesToHex(new TextEncoder().encode(text))
}

export function hexToUtf8(hex: string): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(hexToBytes(hex))
}

export async function sha256Hex(hex: string): Promise<string> {
  const bytes = hexToBytes(hex)
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return bytesToHex(new Uint8Array(digest))
}
