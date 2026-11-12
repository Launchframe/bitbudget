import { init, createWallet, signPair, hex, fromHex, check, mustThrow, WasmSigningSession, verify_signature } from "./wasm-protocol.mjs";
import { bitcoin_keypath_sighash, finalize_bitcoin_keypath, unified_sighash, WasmSpendContext } from "./pkg/wallet_mpc.js";

async function run() {
  check(globalThis.isSecureContext, "browser must provide a secure context");
  check(typeof globalThis.crypto?.getRandomValues === "function", "browser WebCrypto is missing");
  let randomCalls = 0;
  const realRandom = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (array) => { randomCalls += 1; return realRandom(array); };
  const exports = await init();
  check(exports.memory instanceof WebAssembly.Memory, "real WASM was not instantiated");
  const beforeDkg = randomCalls;
  const shares = createWallet();
  check(randomCalls > beforeDkg, "DKG did not invoke browser WebCrypto");
  const script = `5120${hex(shares.get(1).output_key())}`;
  const outpoint = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tx = fromHex(`0200000001${outpoint}0000000000fdffffff01a00f00000000000022${script}00000000`);
  const spent = fromHex(`01881300000000000022${script}`);
  const context = WasmSpendContext.key_path(new Uint8Array());
  const unified = unified_sighash(tx, spent, 0, context);
  const digests = [0, 1].map((kind) => bitcoin_keypath_sighash(tx, spent, 0, kind));
  check(hex(digests[0]) !== hex(digests[1]), "BIP341 hash types were conflated");
  check(digests.every((digest) => hex(digest) !== hex(unified)), "Bitcoin and UnifiedSighash were conflated");
  const cases = [];
  for (const pair of [[1, 2], [1, 3], [2, 3]]) {
    for (const kind of [0, 1]) {
      const digest = digests[kind];
      const { signature } = signPair(shares, pair, digest);
      const raw = finalize_bitcoin_keypath(tx, 0, signature, kind);
      check(raw.length > tx.length, "witness was not serialized");
      const tampered = Uint8Array.from(digest);
      tampered[0] ^= 1;
      mustThrow(() => verify_signature(shares.get(pair[0]).public_package(), tampered, signature), "modified message verified");
      const repeated = signPair(shares, pair, digest).signature;
      check(hex(repeated) !== hex(signature), "fresh signing reused a nonce");
      cases.push(`${pair.map((id) => "ABC"[id - 1]).join("+")}/0x0${kind}`);
    }
  }
  const a = shares.get(1).commit_digest_low_level(digests[0], 2);
  const c = shares.get(3).commit_digest_low_level(digests[0], 1);
  const wrongPair = new WasmSigningSession(digests[0], 1, a.commitment(), 3, c.commitment());
  mustThrow(() => a.sign(shares.get(1), wrongPair), "wrong participant pair signed");
  c.free();
  wrongPair.free();
  context.free();
  for (const share of shares.values()) share.free();
  return { result: "passed", runtime: "actual browser WebAssembly/WebCrypto", cases, webcrypto_calls: randomCalls, verification: "FROST/k256 and C libsecp256k1 inside WASM", chain_acceptance: "separate regtest harness", application_flow: "not tested" };
}

window.walletProof = run();
