import init, { WasmDkgRound1, WasmSigningSession, verify_signature } from "./pkg/wallet_mpc.js";

export { init, WasmSigningSession, verify_signature };
export const ids = [1, 2, 3];
export const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const fromHex = (value) => {
  if (!/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error("invalid hex");
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
};
export function check(condition, message) {
  if (!condition) throw new Error(message);
}
export function mustThrow(callback, message) {
  let failed = false;
  try { callback(); } catch { failed = true; }
  check(failed, message);
}

export function createWallet() {
  const starts = new Map(ids.map((id) => [id, new WasmDkgRound1(id)]));
  const broadcasts = new Map(ids.map((id) => [id, starts.get(id).broadcast()]));
  const roundTwo = new Map(ids.map((id) => {
    const peers = ids.filter((peer) => peer !== id);
    return [id, starts.get(id).advance(peers[0], broadcasts.get(peers[0]), peers[1], broadcasts.get(peers[1]))];
  }));
  for (const state of roundTwo.values()) {
    check(hex(state.broadcast_digest()) === hex(roundTwo.get(1).broadcast_digest()), "DKG broadcast disagreement");
  }
  const incoming = new Map(ids.map((id) => [id, new Map()]));
  for (const sender of ids) {
    for (const recipient of ids.filter((id) => id !== sender)) {
      incoming.get(recipient).set(sender, roundTwo.get(sender).take_message(recipient));
    }
  }
  const shares = new Map(ids.map((id) => {
    const peers = ids.filter((peer) => peer !== id);
    const messages = incoming.get(id);
    const share = roundTwo.get(id).finish(peers[0], messages.get(peers[0]), peers[1], messages.get(peers[1]));
    for (const message of messages.values()) message.fill(0);
    return [id, share];
  }));
  for (const share of shares.values()) {
    check(hex(share.public_package()) === hex(shares.get(1).public_package()), "DKG public-package disagreement");
  }
  return shares;
}

export function signPair(shares, pair, digest) {
  const nonces = pair.map((id, index) => shares.get(id).commit_digest_low_level(digest, pair[1 - index]));
  const commitments = nonces.map((nonce) => nonce.commitment());
  const session = new WasmSigningSession(digest, pair[0], commitments[0], pair[1], commitments[1]);
  const partials = pair.map((id, index) => nonces[index].sign(shares.get(id), session));
  mustThrow(() => nonces[0].sign(shares.get(pair[0]), session), "consumed nonce was reusable");
  const publicPackage = shares.get(pair[0]).public_package();
  mustThrow(() => session.aggregate(publicPackage, pair[0], partials[0], pair[0], partials[0]), "duplicate signer was accepted");
  const signature = session.aggregate(publicPackage, pair[0], partials[0], pair[1], partials[1]);
  verify_signature(publicPackage, digest, signature);
  session.free();
  return { signature, partials };
}
