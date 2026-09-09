export const READ_METHODS = Object.freeze([
  "server.version", "server.features", "server.ping", "blockchain.headers.subscribe",
  "blockchain.block.header", "blockchain.block.headers", "blockchain.scripthash.subscribe",
  "blockchain.scripthash.unsubscribe", "blockchain.scripthash.get_balance",
  "blockchain.scripthash.get_history", "blockchain.scripthash.listunspent",
  "blockchain.transaction.get", "blockchain.transaction.get_merkle", "blockchain.estimatefee",
  "mempool.get_fee_histogram",
])
export const REQUEST_BYTES = 16_384
export const RESPONSE_BYTES = 2_097_152
export const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value)
const natural = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff
const hash = value => typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value)
const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)

export function validateRequest(value) {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "id,jsonrpc,method,params" || value.jsonrpc !== "2.0" || !Number.isSafeInteger(value.id) || value.id < 0 || !Array.isArray(value.params)) return "invalid-request"
  if (!READ_METHODS.includes(value.method)) return "method-not-allowed"
  const p = value.params
  let valid = false
  switch (value.method) {
    case "server.version": valid = p.length <= 2 && (p.length === 0 || text(p[0], 128)) && (p.length < 2 || text(p[1], 32) || (Array.isArray(p[1]) && p[1].length === 2 && p[1].every(version => text(version, 32)))); break
    case "server.features": case "server.ping": case "blockchain.headers.subscribe": case "mempool.get_fee_histogram": valid = p.length === 0; break
    case "blockchain.block.header": valid = p.length >= 1 && p.length <= 2 && p.every(natural); break
    case "blockchain.block.headers": valid = p.length >= 2 && p.length <= 3 && p.every(natural) && p[1] > 0 && p[1] <= 2016; break
    case "blockchain.scripthash.subscribe": case "blockchain.scripthash.unsubscribe": case "blockchain.scripthash.get_balance": case "blockchain.scripthash.get_history": case "blockchain.scripthash.listunspent": valid = p.length === 1 && hash(p[0]); break
    case "blockchain.transaction.get": valid = p.length >= 1 && p.length <= 2 && hash(p[0]) && (p.length === 1 || typeof p[1] === "boolean"); break
    case "blockchain.transaction.get_merkle": valid = p.length === 2 && hash(p[0]) && natural(p[1]); break
    case "blockchain.estimatefee": valid = p.length === 1 && natural(p[0]) && p[0] > 0 && p[0] <= 1008; break
  }
  return valid ? null : "invalid-params"
}
