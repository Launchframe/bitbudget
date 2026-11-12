import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import init, {
  WasmDkgRound1,
  WasmWalletShare,
  WasmSigningSession,
  WasmSpendContext,
  unified_sighash,
  verify_signature,
} from "./pkg/wallet_mpc.js";

assert.equal(process.versions.node.split(".")[0], "22", "run this proof on pinned Node 22");
assert.ok(globalThis.crypto?.getRandomValues, "WebCrypto CSPRNG is required");
let randomCalls = 0;
const realRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
globalThis.crypto.getRandomValues = (array) => {
  randomCalls += 1;
  return realRandom(array);
};

const artifact = await readFile(new URL("./pkg/wallet_mpc_bg.wasm", import.meta.url));
assert.deepEqual([...artifact.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
const exports = await init({ module_or_path: artifact });
assert.ok(exports.memory instanceof WebAssembly.Memory);
const ids = [1, 2, 3];
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const bytes = (value) => Uint8Array.from(Buffer.from(value, "hex"));
const changed = (value) => {
  const copy = Uint8Array.from(value);
  copy[copy.length - 1] ^= 1;
  return copy;
};
const same = (a, b) => assert.equal(hex(a), hex(b));
const le32 = (n) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(n);
  return buffer;
};
const le64 = (n) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(n));
  return buffer;
};
const compactSize = (n) => {
  if (n < 253) return Buffer.from([n]);
  if (n <= 65535) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 253;
    buffer.writeUInt16LE(n, 1);
    return buffer;
  }
  return Buffer.concat([Buffer.from([254]), le32(n)]);
};
const output = (amount, script) => Buffer.concat([le64(amount), compactSize(script.length), script]);

function generateWallet() {
  const starts = new Map(ids.map((id) => [id, new WasmDkgRound1(id)]));
  const broadcasts = new Map(ids.map((id) => [id, starts.get(id).broadcast()]));
  const roundTwo = new Map(ids.map((id) => {
    const peers = ids.filter((peer) => peer !== id);
    const state = starts.get(id).advance(peers[0], broadcasts.get(peers[0]), peers[1], broadcasts.get(peers[1]));
    assert.throws(() => starts.get(id).broadcast(), "round one must be consumed");
    return [id, state];
  }));
  for (const id of ids) same(roundTwo.get(id).broadcast_digest(), roundTwo.get(1).broadcast_digest());
  const incoming = new Map(ids.map((id) => [id, new Map()]));
  for (const sender of ids) {
    for (const recipient of ids.filter((id) => id !== sender)) {
      incoming.get(recipient).set(sender, roundTwo.get(sender).take_message(recipient));
      assert.throws(() => roundTwo.get(sender).take_message(recipient));
    }
  }
  const shares = new Map(ids.map((id) => {
    const peers = ids.filter((peer) => peer !== id);
    const messages = incoming.get(id);
    const share = roundTwo.get(id).finish(peers[0], messages.get(peers[0]), peers[1], messages.get(peers[1]));
    for (const message of messages.values()) message.fill(0);
    assert.throws(() => roundTwo.get(id).broadcast_digest(), "round two must be consumed");
    return [id, share];
  }));
  for (const id of ids) {
    assert.equal(shares.get(id).participant(), id);
    same(shares.get(id).public_package(), shares.get(1).public_package());
    same(shares.get(id).output_key(), shares.get(1).output_key());
    const secret = shares.get(id).export_secret_share();
    const publicPackage = shares.get(id).public_package();
    assert.throws(() => WasmWalletShare.import_secret_share(id % 3 + 1, secret, publicPackage));
    const restored = WasmWalletShare.import_secret_share(id, secret, publicPackage);
    secret.fill(0);
    shares.get(id).free();
    shares.set(id, restored);
  }
  return shares;
}

function prepare(shares, pair, digest) {
  const nonces = pair.map((id, index) => shares.get(id).commit_digest_low_level(digest, pair[1 - index]));
  const commitments = nonces.map((nonce) => nonce.commitment());
  const original = new WasmSigningSession(digest, pair[0], commitments[0], pair[1], commitments[1]);
  const encoded = original.serialize();
  original.free();
  const session = WasmSigningSession.deserialize(encoded);
  same(session.serialize(), encoded);
  return { nonces, commitments, session };
}

function signPair(shares, pair, digest) {
  const { nonces, commitments, session } = prepare(shares, pair, digest);
  assert.throws(() => new WasmSigningSession(digest, pair[0], commitments[0], pair[0], commitments[0]));
  const partials = pair.map((id, index) => nonces[index].sign(shares.get(id), session));
  assert.throws(() => nonces[0].sign(shares.get(pair[0]), session), "nonce reuse must fail in actual generated bindings");
  const publicPackage = shares.get(pair[0]).public_package();
  assert.throws(() => session.aggregate(publicPackage, pair[0], partials[0], pair[1], new Uint8Array()));
  assert.throws(() => session.aggregate(publicPackage, pair[0], partials[0], pair[0], partials[0]));
  assert.throws(() => session.aggregate(publicPackage, pair[0], partials[0], pair[1], changed(partials[1])));
  const absent = ids.find((id) => !pair.includes(id));
  assert.throws(() => session.aggregate(publicPackage, pair[0], partials[0], absent, partials[1]));
  const signature = session.aggregate(publicPackage, pair[0], partials[0], pair[1], partials[1]);
  assert.equal(signature.length, 64);
  verify_signature(publicPackage, digest, signature);
  assert.throws(() => verify_signature(publicPackage, changed(digest), signature));
  assert.throws(() => verify_signature(publicPackage, digest, changed(signature)));
  session.free();
  return signature;
}

const badStarts = ids.map((id) => new WasmDkgRound1(id));
assert.throws(() => badStarts[0].advance(2, changed(badStarts[1].broadcast()), 3, badStarts[2].broadcast()));
badStarts[1].free();
badStarts[2].free();
const beforeDkg = randomCalls;
const shares = generateWallet();
assert.ok(randomCalls > beforeDkg, "DKG must actually invoke WebCrypto random generation");
const script = Buffer.concat([Buffer.from([0x51, 0x20]), shares.get(1).output_key()]);
const input = () => Buffer.concat([crypto.getRandomValues(new Uint8Array(32)), le32(0), Buffer.from([0]), le32(0xfffffffd)]);
const tx = Buffer.concat([le32(2), Buffer.from([2]), input(), input(), Buffer.from([1]), output(9000, script), le32(500001)]);
const spent = Buffer.concat([Buffer.from([2]), output(5000, script), output(5000, script)]);
const keyPath = WasmSpendContext.key_path(new Uint8Array());
const digest = unified_sighash(tx, spent, 0, keyPath);
assert.equal(digest.length, 32);
assert.equal(tx.readUInt32LE(tx.length - 4), 500001);
assert.throws(() => unified_sighash(tx, spent, 2, keyPath));
assert.throws(() => unified_sighash(tx, new Uint8Array(), 0, keyPath));
const signatures = [];
for (const pair of [[1, 2], [1, 3], [2, 3]]) signatures.push(signPair(shares, pair, digest));
assert.equal(new Set(signatures.map(hex)).size, 3);
assert.notEqual(hex(signPair(shares, [1, 2], digest)), hex(signatures[0]));

const fresh = prepare(shares, [1, 2], digest);
const another = prepare(shares, [1, 2], digest);
assert.notEqual(hex(fresh.commitments[0]), hex(another.commitments[0]));
assert.throws(() => fresh.nonces[0].sign(shares.get(1), another.session));
assert.throws(() => fresh.nonces[0].commitment());
fresh.nonces[1].free();
fresh.session.free();
const altered = new WasmSigningSession(changed(digest), 1, another.commitments[0], 2, another.commitments[1]);
assert.throws(() => another.nonces[0].sign(shares.get(1), altered));
another.nonces[1].free();
another.session.free();
altered.free();

const wrongPair = prepare(shares, [1, 2], digest);
const cNonce = shares.get(3).commit_digest_low_level(digest, 1);
const acSession = new WasmSigningSession(digest, 1, wrongPair.commitments[0], 3, cNonce.commitment());
assert.throws(() => wrongPair.nonces[0].sign(shares.get(1), acSession));
wrongPair.nonces[1].free();
cNonce.free();
wrongPair.session.free();
acSession.free();

const vectors = JSON.parse(await readFile(new URL("./src/unified-vectors.json", import.meta.url), "utf8"));
assert.equal(vectors.length - 1, 166, "all upstream vectors must be bundled offline");
let vectorCount = 0;
for (const [scriptHex, txHex, inputIndex, hashType, scriptType, outputs, expected] of vectors.slice(1)) {
  if (hashType !== 0x21 || ![2, 3].includes(scriptType)) continue;
  const vectorContext = scriptType === 2
    ? WasmSpendContext.key_path(new Uint8Array())
    : WasmSpendContext.tapscript(bytes(scriptHex), 0xffffffff, new Uint8Array());
  const spentBytes = Buffer.concat([compactSize(outputs.length), ...outputs.map(([amount, scriptHex]) => output(amount, bytes(scriptHex)))]);
  assert.equal(hex(unified_sighash(bytes(txHex), spentBytes, inputIndex, vectorContext)), expected);
  vectorContext.free();
  vectorCount += 1;
}
assert.equal(vectorCount, 4);
const annex = WasmSpendContext.key_path(Uint8Array.from([0x50, 1]));
assert.notEqual(hex(unified_sighash(tx, spent, 0, annex)), hex(digest));
annex.free();
keyPath.free();
for (const share of shares.values()) share.free();
console.log(JSON.stringify({
  result: "passed",
  runtime: process.version,
  artifact_sha256: createHash("sha256").update(artifact).digest("hex"),
  dkg: "real 2-of-3 FROST through web-target WASM bindings",
  pairs: ["A+B", "A+C", "B+C"],
  verification: "FROST/k256 and independent libsecp256k1, both in WASM",
  webcrypto_calls: randomCalls,
  offline_wasm_vectors: vectorCount,
  negative_tests: "bad DKG, wrong/duplicate/missing shares, digest/pair/commitment tampering, consumed nonce/state reuse",
  chain_acceptance: "not tested; transaction fixture has fictional outpoints",
}));
