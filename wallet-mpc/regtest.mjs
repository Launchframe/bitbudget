import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bitcoin_keypath_sighash, finalize_bitcoin_keypath } from "./pkg/wallet_mpc.js";
import { init, createWallet, signPair, hex, fromHex, WasmSigningSession, mustThrow } from "./wasm-protocol.mjs";

assert.equal(process.versions.node.split(".")[0], "22");
assert.ok(globalThis.crypto?.getRandomValues);
const rpcUrl = new URL(process.env.WALLET_REGTEST_RPC_URL);
assert.equal(rpcUrl.protocol, "http:");
assert.equal(rpcUrl.hostname, "node");
assert.equal(rpcUrl.port, "18443");
const password = process.env.WALLET_REGTEST_RPC_PASSWORD;
assert.match(password, /^[0-9a-f]{64}$/);
const authorization = `Basic ${Buffer.from(`wallet-regtest:${password}`).toString("base64")}`;
let requestId = 0;
async function rpc(method, params = [], wallet = false) {
  const endpoint = wallet ? new URL("/wallet/miner", rpcUrl) : rpcUrl;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`regtest ${method}: ${body.error.code} ${body.error.message}`);
  assert.equal(response.status, 200);
  return body.result;
}
let ready = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    assert.equal((await rpc("getblockchaininfo")).chain, "regtest");
    ready = true;
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
assert.ok(ready, "disposable regtest node failed to become ready");
assert.equal((await rpc("getnetworkinfo")).version, 290000);
assert.equal((await rpc("getnetworkinfo")).connections, 0);
await init({ module_or_path: await readFile(new URL("./pkg/wallet_mpc_bg.wasm", import.meta.url)) });
const shares = createWallet();
const variants = [{ name: "root", shares }];
for (const value of [1, 2]) {
  const tweak = new Uint8Array(32).fill(value);
  variants.push({ name: `child-${value}`, shares: new Map([...shares].map(([id, share]) => [id, share.derive_child(tweak)])) });
}
await rpc("createwallet", ["miner"]);
const miningAddress = await rpc("getnewaddress", ["mining", "bech32"], true);
await rpc("generatetoaddress", [101, miningAddress]);
const cases = [];
for (const variant of variants) {
  const outputKey = hex(variant.shares.get(1).output_key());
  const outputScript = `5120${outputKey}`;
  const descriptor = await rpc("getdescriptorinfo", [`rawtr(${outputKey})`]);
  const [address] = await rpc("deriveaddresses", [descriptor.descriptor]);
  assert.ok(address.startsWith("bcrt1p"));
  assert.equal((await rpc("validateaddress", [address])).scriptPubKey, outputScript);
  for (const pair of [[1, 2], [1, 3], [2, 3]]) {
    for (const hashType of [0, 1]) {
      const fundingTxid = await rpc("sendtoaddress", [address, 0.01], true);
      const decoded = await rpc("decoderawtransaction", [(await rpc("gettransaction", [fundingTxid], true)).hex]);
      const matches = decoded.vout.filter((output) => output.scriptPubKey.hex === outputScript && output.value === 0.01);
      assert.equal(matches.length, 1);
      cases.push({ pair, hashType, fundingTxid, vout: matches[0].n, outputScript, variant });
    }
  }
}
assert.equal(new Set(cases.map((item) => `${item.fundingTxid}:${item.vout}`)).size, 18);
await rpc("generatetoaddress", [1, miningAddress]);
const accepted = [];
const rejected = [];
const amountBytes = Buffer.alloc(8);
amountBytes.writeBigUInt64LE(1000000n);
async function reject(raw, name) {
  const [result] = await rpc("testmempoolaccept", [[raw]]);
  assert.equal(result.allowed, false, `${name} unexpectedly accepted`);
  const reason = result["reject-reason"] ?? result["package-error"] ?? "";
  assert.match(reason, /script|signature|witness/i, `${name} failed for a non-signature reason: ${reason}`);
  rejected.push({ name, reason });
}
for (const item of cases) {
  const label = `${item.variant.name}/${item.pair.map((id) => "ABC"[id - 1]).join("+")}/0x0${item.hashType}`;
  const spentOutputs = Buffer.concat([Buffer.from([1]), amountBytes, Buffer.from([34]), Buffer.from(item.outputScript, "hex")]);
  const unspent = await rpc("gettxout", [item.fundingTxid, item.vout]);
  assert.ok(unspent.confirmations >= 1);
  assert.equal(unspent.scriptPubKey.hex, item.outputScript);
  assert.equal(unspent.value, 0.01);
  const recipient = await rpc("getnewaddress", ["recipient", "bech32"], true);
  const changedRecipient = await rpc("getnewaddress", ["changed-recipient", "bech32"], true);
  const inputs = [{ txid: item.fundingTxid, vout: item.vout, sequence: 0xfffffffd }];
  const raw = await rpc("createrawtransaction", [inputs, [{ [recipient]: 0.00999 }], 0, true]);
  const digest = bitcoin_keypath_sighash(fromHex(raw), spentOutputs, 0, item.hashType);
  const { signature, partials } = signPair(item.variant.shares, item.pair, digest);
  const finalRaw = hex(finalize_bitcoin_keypath(fromHex(raw), 0, signature, item.hashType));
  const decoded = await rpc("decoderawtransaction", [finalRaw]);
  assert.equal(decoded.vin[0].txid, item.fundingTxid);
  assert.equal(decoded.vin[0].vout, item.vout);
  assert.equal(decoded.vin[0].txinwitness.length, 1);
  assert.equal(decoded.vin[0].txinwitness[0].length, (64 + item.hashType) * 2);
  assert.equal(decoded.vout[0].scriptPubKey.address, recipient);
  assert.equal(decoded.vout[0].value, 0.00999);
  await reject(raw, `${label}:missing-witness`);
  const corrupt = Uint8Array.from(signature);
  corrupt[63] ^= 1;
  await reject(hex(finalize_bitcoin_keypath(fromHex(raw), 0, corrupt, item.hashType)), `${label}:wrong-signature`);
  const changedRaw = await rpc("createrawtransaction", [inputs, [{ [changedRecipient]: 0.00999 }], 0, true]);
  await reject(hex(finalize_bitcoin_keypath(fromHex(changedRaw), 0, signature, item.hashType)), `${label}:changed-recipient`);
  const incomplete = new Uint8Array(64);
  incomplete.set(partials[0]);
  await reject(hex(finalize_bitcoin_keypath(fromHex(raw), 0, incomplete, item.hashType)), `${label}:only-one-share`);
  const [result] = await rpc("testmempoolaccept", [[finalRaw]]);
  assert.equal(result.allowed, true, `${label}: ${JSON.stringify(result)}`);
  const txid = await rpc("sendrawtransaction", [finalRaw]);
  assert.equal(txid, decoded.txid);
  const [blockhash] = await rpc("generatetoaddress", [1, miningAddress]);
  const block = await rpc("getblock", [blockhash]);
  assert.ok(block.tx.includes(txid));
  assert.equal(await rpc("gettxout", [item.fundingTxid, item.vout]), null);
  assert.ok((await rpc("getrawtransaction", [txid, true])).confirmations >= 1);
  accepted.push({ pair: label, txid, blockhash, confirmations: 1 });
}
const digest = new Uint8Array(32);
const a = shares.get(1).commit_digest_low_level(digest, 2);
const c = shares.get(3).commit_digest_low_level(digest, 1);
const wrongPair = new WasmSigningSession(digest, 1, a.commitment(), 3, c.commitment());
mustThrow(() => a.sign(shares.get(1), wrongPair), "A+B nonce accepted an A+C session");
c.free();
wrongPair.free();
for (const variant of variants) for (const share of variant.shares.values()) share.free();
assert.equal(accepted.length, 18);
assert.equal(rejected.length, 72);
console.log(JSON.stringify({ result: "passed", chain: "regtest", node_version: 290000, wallet_count: 1, accepted, rejected, wrong_pair_session: "rejected by WASM before signing", application_flow: "not tested" }));
