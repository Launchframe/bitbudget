# Wallet MPC cryptographic core proof

This isolated Rust crate implements real 2-of-3 FROST distributed key generation and threshold Schnorr signing. It is a tested cryptographic core, not a production wallet or a browser integration. It does not implement seed concatenation, dealer key splitting, or full-private-key reconstruction. The tests simulate separate participants in one process; production must put the participants in separate trust domains.

## Pinned implementation references

- `frost-secp256k1-tr =3.0.0`, Zcash Foundation, release published 2026-04-23. Inspected through `gh api`, using tag `frost-secp256k1-tr/v3.0.0`, commit `2016e44ba4a4757a996300350063b937a2ad33e8`: `frost-secp256k1-tr/src/lib.rs`, `src/keys/dkg.rs`, `dkg.md`, both Cargo manifests, and `frost-core/src/keys/dkg.rs`.
- FROST uses RustCrypto `k256` internally. The tests independently verify its resulting 64-byte BIP340 signatures with `secp256k1 =0.31.1`, which wraps the C libsecp256k1 implementation. The FROST upstream itself uses the compatible 0.31 series for interoperability tests.
- Bitcoin transaction primitives and consensus serialization come from `bitcoin =0.32.8`; no custom Bitcoin wire transaction parser is used.
- UnifiedSighash is pinned to Knots commit `8c85b1585dac23f964e2dd32045624de7f02aa58`, specifically `doc/unified-sighash.md`, `src/script/interpreter.cpp::SignatureHashUnified`, and `src/test/data/unified_sighash.json`. This is a draft fork-specific algorithm, not Bitcoin mainnet BIP341.
- Direct dependency versions are exact in `Cargo.toml`; `Cargo.lock` locks transitive versions and registry checksums. Run with `--locked`. No dependency audit of this application wrapper has been performed.

Important upstream behavior: FROST's `post_dkg` already applies the BIP341 unspendable-script-path tweak to the joint key and shares. `PublicPackage::output_key()` returns that already-tweaked x-only **output key**, not an internal key. Construct its P2TR script directly as `OP_1 PUSH32 <output_key>`; do not feed it to a helper that applies another TapTweak. Signing uses ordinary `round2::sign` and `aggregate`, not their `with_tweak` variants. A custom script tree/control-block workflow is not implemented here.

## Native API

`Participant::{A,B,C}` are fixed identifiers 1, 2, and 3. Threshold and roster size are fixed at 2 and 3.

1. Each participant independently calls `DkgRound1::start(id)` using `OsRng`, then sends `broadcast()` to the other two over authenticated consistent broadcast.
2. `advance(Vec<(Participant, Vec<u8>)>)` consumes the first state, verifies both other participants' proofs, and returns a `DkgRound2` plus recipient-specific `Round2Messages`. These messages contain secret contributions: use confidential, authenticated point-to-point channels, never a public relay payload without encryption.
3. All participants must compare `DkgRound2::broadcast_digest()` through the authenticated broadcast protocol before completing. This digest includes all three participant identifiers and length-delimited broadcast packages. Merely receiving a coordinator's claim of agreement is insufficient. The core exposes this check value; it does not implement transport agreement.
4. `finish(Round2Messages)` consumes the second state and verifies received secret contributions against the exact round-one transcript retained internally. It returns one `WalletShare`, never a full key. Compare the resulting public-package bytes across all three participants too.
5. Each selected signer calls `WalletShare::commit(digest, pair)` after independently validating the transaction and authorizing that exact digest. This returns a non-cloneable `SigningNonce`; publish only its `commitment()`.
6. `SigningSession::new(digest, commitments)` requires exactly two distinct participant identifiers. Its public package can be serialized/deserialized.
7. Each `SigningNonce::sign(self, &share, &session)` consumes its nonce, including on errors. It checks the originally authorized digest, pair, own commitment, participant, and wallet output key. Nonces cannot be serialized, cloned, or reused through this API. Retry requires a fresh commitment exchange.
8. `SigningSession::aggregate(&public, shares)` requires the exact two participant identifiers, checks the signature shares through FROST, and returns 64 BIP340 bytes. `PublicPackage::verify` verifies those bytes.

`PublicPackage` and `SigningSession` serialize using the pinned FROST serialization format. `WalletShare::export_secret_share()` returns a **plaintext secret share** inside `Zeroizing<Vec<u8>>`, exclusively for caller-controlled encryption or local secure transfer. `import_secret_share` validates identity, threshold, group public key, verifying share, and the signing-share/verifying-share relation. There is no plaintext server persistence or logging. DKG states support consuming `export_secret_state()` and participant-bound `restore_secret_state(id, bytes)` for encrypted persistence across requests. Exported bytes are plaintext secrets and must be authenticated-encrypted with wallet, account, network, stage and transcript context before storage; restoration validates bounded format, stage, participant and roster, not transport authentication or rollback history. WASM round-two export requires retrieving all outbound contributions first so they can be persisted in the separately encrypted retry response. Signing nonces remain nonserializable and single-use. Secret state uses upstream zeroization. This is not a guarantee against process snapshots, swapping, memory-copy remnants, or a compromised runtime.

Every caller must authenticate participant IDs, bind exchanges to a unique wallet/DKG/signing session, prevent transcript replay across sessions, enforce broadcast consistency, and abort on disagreement. The core does not supply networking, session authentication, encrypted transport, durable anti-rollback storage, recovery policy, or UI consent.

## Private indexed output keys

The explicit `taptweak-hmac-sha256-v1` policy derives fresh output keys without changing the DKG root. It is not BIP32 and does not make an interoperable xpub. A random 32-byte client-only watch seed produces an opaque merkle-root argument:

`HMAC-SHA256(seed, ASCII("BitBudget/FROST/derive/v1") || SHA256(serialized_root_public_package) || network_u8 || branch_u8 || index_u32_be)`

Network codes are mainnet=0, testnet=1, testnet4=2, signet=3, regtest=4. Branch codes are receive=0 and change=1. Indices range from 0 through `0x7fffffff`. Lineage is intentionally absent: both lineages use the same wallet identity and indexed keys.

`PublicPackage::derive_child` and `WalletShare::derive_child` clone the root packages and apply the pinned FROST `keys::Tweak(Some(merkle_root))` once. This is an **explicit new child-key policy**, not an accidental second tweak of the base address. Construct the child P2TR script directly from its output key, and use ordinary `sign`/`aggregate` on the child packages. The WASM public-only functions are `derive_public_package` and `public_package_output_key`. Monitoring can compute the same public output with scure's public TapTweak helper without unlocking a signing share or loading the FROST WASM.

The derivation context contains only the policy prefix and `SHA256(seed)`. New recovery envelopes use version 2: the authenticated encrypted payload is `metadata_length_u32_be || metadata_json || share_length_u32_be || share_bytes || seed_32`. The seed is never in plaintext envelope metadata or sent to the co-signer. Version 1 base-output backups remain supported and are not silently upgraded. A separately encrypted watch-seed envelope allows client-side monitoring after the budget privacy key is unlocked. A co-signer given a per-spend tweak can infer that spent address, but cannot enumerate other derived addresses without the seed. This composition has interoperability tests, not an independent security audit.

## UnifiedSighash API

`UnifiedSighash::new(&Transaction, &[TxOut])` requires one spent output per input in input order and computes immutable single-SHA256 aggregate caches. `digest(input, SpendContext)` always uses the internal default `0x21` (ALL | UNIFIED), committing all inputs and outputs. `preimage` exposes the exact digest preimage for inspection. `digest_with_type` additionally implements the specified NONE/SINGLE/ANYONECANPAY modes and legacy hash-byte semantics; wallet callers should use `digest`.

Contexts are explicit:

- `KeyPath { annex }`: type 2.
- `Tapscript { annex, tapleaf_hash, code_separator }`: type 3, key version zero, `u32::MAX` for no executed code separator. Use rust-bitcoin's `TapLeafHash::from_script` with the intended leaf version.
- `Legacy { script_code }` and `SegwitV0 { script_code }`: types 0 and 1. The caller must supply the execution-appropriate, already-processed scriptCode. This crate does not execute scripts or perform legacy FindAndDelete.

The transaction wire locktime stays four bytes. Only the digest preimage has five bytes: the normal four little-endian bytes followed by zero. The final digest is `TaggedHash("UnifiedSighash", preimage)` with epoch zero. Annexes must start with `0x50` and commit their CompactSize-prefixed encoding. SINGLE without a corresponding output, unsupported Taproot hash types, missing spent outputs, and invalid input indices fail.

`encode_unified_signature` appends `0x21` to a 64-byte signature, yielding a 65-byte witness signature. It is only for signatures produced with the default digest. Script execution, UTXO authenticity, amount/fee policy, chain activation, full transaction signing/finalization, PSBT integration, and node acceptance remain caller responsibilities. A normal BIP341 digest must be used for the Bitcoin lineage; this module intentionally does not silently substitute one.

## Bitcoin key-path API

`taproot::keypath_digest` and WASM `bitcoin_keypath_sighash(transaction, spent_outputs, input, hash_type)` use rust-bitcoin's vetted `SighashCache::taproot_key_spend_signature_hash`. They support only BIP341 key-path `0x00` (DEFAULT) and `0x01` (ALL), with no annex. They explicitly validate the input index and require every spent output in input order. This is separate from UnifiedSighash; `0x21` is rejected here.

`taproot::finalize_keypath` and WASM `finalize_bitcoin_keypath(transaction, input, signature, hash_type)` attach a 64-byte signature as a standard Bitcoin witness using rust-bitcoin transaction primitives. DEFAULT has no suffix; ALL appends `0x01`. Existing scriptSig/witness data on that input is rejected rather than overwritten. The finalizer is serialization, not authorization or signature verification: callers must verify the signature and the actual transaction policy independently.

## Verification

Run from `wallet-mpc/`:

```sh
cargo test --locked
cargo test --locked --all-features
cargo test --locked pinned_knots_all_166_offline_vectors
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo fmt --check
```

Validated on Rust 1.94.1:

- Ten offline tests pass, including durable DKG round-state restoration, BIP341 hash-type separation, input validation and witness serialization: genuine three-party DKG; A+B, A+C, and B+C signing with independent BIP340 verification; one/duplicate/wrong/replayed/corrupted shares; modified message, pair and nonce commitment; bad DKG proofs and wrong-recipient contributions; secret/public/session serialization; fresh nonces and signatures; transaction/context mutations and wire round trips.
- All **166 upstream vectors across all four script types** are bundled verbatim in `src/unified-vectors.json` and run in normal `cargo test`; there are no ignored network tests. The test checks their pinned Git blob ID `7f6c9685bf913cba28a334ff5b2bd1b447d44d56` before checking every digest.
- `node refresh-unified-vectors.mjs` is an explicit maintenance operation, not part of tests or builds. It fetches only the pinned public fixture through `gh api`, checks its inspected Git blob ID and shape, then replaces the local fixture. It never contacts a blockchain node.
- `cargo check --locked --features wasm` and native all-feature tests validate the binding code's types. Use the separate WASM runtime proof below to exercise generated bindings and WebCrypto.

## WASM interface and isolated build

The optional `wasm` feature provides real `wasm-bindgen =0.2.114` classes: `WasmDkgRound1`, `WasmDkgRound2`, `WasmWalletShare`, `WasmSigningNonce`, `WasmSigningSession`, and `WasmSpendContext`, plus `unified_sighash`, `bitcoin_keypath_sighash`, `finalize_bitcoin_keypath` and `verify_signature`. APIs use numeric participant IDs and byte arrays; no mock cryptography is present. Round-two outgoing messages are retrieved once with `take_message(recipient)`. DKG advance/finish and nonce sign consume their state.

`unified_sighash(transaction, spent_outputs, input, context)` accepts a normal consensus-encoded transaction and a consensus-encoded `Vec<TxOut>` (CompactSize count followed by each output), returning 32 digest bytes under `0x21`. The context constructors are `key_path(annex_bytes)` and `tapscript(script, code_separator, annex_bytes)`; an empty annex array means absent. Tapscript construction uses leaf version `0xc0`.

The digest-signing interface is deliberately named **`WasmWalletShare.commit_digest_low_level`**. Like native `WalletShare::commit`, it signs an arbitrary caller-supplied 32-byte digest; it does not authenticate a user or establish what a transaction means. Never expose it as an unauthenticated UI/HTTP signing endpoint. A coordinator must separately authenticate the participant/session, reconstruct and validate the transaction, obtain explicit authorization, then pass that exact digest. No coordinator or migration readiness is implied by this primitive.

From the repository root, with Docker running:

```sh
bash scripts/build-wallet-mpc.sh
```

The script inspects both pinned image manifests before executing, builds the isolated toolchain, runs native tests, builds `--target wasm32-unknown-unknown --features wasm --release --locked`, and generates **`--target web`** JS/TypeScript bindings into ignored `wallet-mpc/pkg/`. It then runs `wasm-smoke.mjs` on Node 22 with WebCrypto in a read-only, network-disabled container. Missing artifacts or failed cryptographic operations are errors, never skips. There are no host bind mounts: Docker Desktop need not expose `/Library/Personal`. A strict allowlist sends only the crate manifests, Rust source, public test fixtures, build/test scripts and this README from `wallet-mpc/` as the build context. After the proof passes, `docker cp` exports only `pkg/` from a temporary stopped container. No repository environment files, Docker socket, public ports, or host compiler configuration are exposed to the build containers.

Toolchain inputs:

- Rust `1.94.1-bookworm`, image index `sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55`.
- Node `22.22.2-bookworm-slim`, image index `sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e`.
- Debian snapshot `20260407T000000Z`, Clang/LLVM/LLD package version `1:14.0.6-12`; tools are installed only inside Docker.
- wasm-bindgen CLI `0.2.114` installed with `cargo install --locked`; application dependencies use the existing Cargo lock.

The build prints its local Docker image ID and SHA256 hashes for the WASM, JS and TypeScript artifacts. The runtime proof imports those generated web bindings and initializes the real WASM module; it exercises genuine DKG, all three signer pairs, serialization, failing bad transcripts/shares, fresh nonces, and rejection of attempts to reuse consumed nonce handles. Its randomness counter delegates every call to Node's real WebCrypto CSPRNG. `verify_signature` checks both FROST/k256 and independently compiled C libsecp256k1 inside WASM. Four pinned key-path/tapscript `0x21` vectors are checked through the WASM digest API; all 166 run through native Rust tests.

The basic `wasm-smoke.mjs` test is a Node/WebCrypto proof with fictional outpoints; it submits nothing. The additional browser and real-UTXO regtest tests below cover those distinct layers. Multi-device trust-domain isolation, application bundler integration, PSBT workflows, authenticated coordinators and application user flows are not established by any of these tests. Host Apple Clang remains untouched; its missing WASM backend is not worked around with substitute cryptography.

JavaScript copies of secret messages and exported shares are not protected by Rust's `Zeroizing`. Encrypt them immediately in the caller, avoid browser storage in plaintext, clear caller-controlled buffers, and do not promise reliable erasure of JS-engine copies. The UI, Node relay, Nostr transport, encrypted share storage, wallet transaction policy, and both lineage integrations are deliberately untouched.

## Isolated regtest acceptance

From the repository root:

```sh
bash scripts/test-wallet-regtest.sh
```

The test requires working Docker and a successful real WASM build; unavailable prerequisites fail, never skip. It uses `bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78`. Bitcoin Core v29.0 is a stable release published 2025-04-15, and the script enforces a minimum seven-day release age. The container RPC must report version 290000 and chain `regtest` before any wallet or mining calls.

This is an **unofficial testing image**, not endorsed by Bitcoin Core. Its inspected maintainer source is [willcl-ark/bitcoin-core-docker at a4e4497cbf7c159719b57a5f7992cd35a8b3752f](https://github.com/willcl-ark/bitcoin-core-docker/blob/a4e4497cbf7c159719b57a5f7992cd35a8b3752f/29.0/Dockerfile); that build downloads the release binaries and requires six good signatures through its verification script. The image digest is pinned and inspected before execution. It is used only for disposable testing, never real funds.

The node and WASM runner share a uniquely named **internal Docker network**, with no published RPC/P2P ports, no host mounts, non-root bitcoind, disabled peer discovery/connections, and fresh local-only test RPC credentials. Chain and miner-wallet data live in container tmpfs. Cleanup traps remove only the container/network IDs created by the current run; there is no global prune. Raw transactions, chain data and secret shares are not written to the repository. Results print public transaction/block IDs and rejection reasons.

`regtest.mjs` creates **one** WASM DKG wallet, derives its address with Core's `rawtr(output_key)` descriptor, and checks the resulting script equals `OP_1 PUSH32 <output_key>`. This is intentional: DKG already applied the TapTweak. It tests the root and two independently tweaked child output keys, matures local coinbase outputs, funds eighteen distinct confirmed outputs, and spends one per key and combination of A+B/A+C/B+C and DEFAULT/ALL. Each signature is independently verified inside WASM, each finalized transaction is decoded, `testmempoolaccept` must allow it, `sendrawtransaction` must succeed, and a mined block must contain it. The spent outpoint must then disappear from the UTXO set.

Validated outcomes: all **eighteen** cases were accepted and mined; all **72** invalid variants were rejected with mandatory witness/Schnorr errors: missing witness, corrupted signature, changed recipient, and a single signature share padded to signature length. A nonce committed for A+B also rejects an A+C session before signing. Signer-pair identity is an off-chain protocol property: a valid aggregate Schnorr signature does not reveal its signer pair to Core. These are deterministic scenarios/assertions with real CSPRNG keys, not deterministic or hardcoded private keys. There are no fictional outpoints in the acceptance transactions.

## Actual browser WASM proof

After generating `pkg/`, with Node 22 and this project's existing Playwright installation:

```sh
node wallet-mpc/browser-proof.mjs
```

The harness serves an exact read-only allowlist on a random `127.0.0.1` port, loads the generated web-target module in headless Chromium, and blocks page requests to any other origin. It does not start Next.js, authenticate a user, read application environment files, access a database or run migrations. It closes the browser and server on success or failure. Missing artifacts, browser binaries and cryptographic failures are fatal.

Validated with Playwright **1.59.1**, Node **22.22.3**, and actual Chromium **148.0.7778.96**: all six pair/hash-type cases passed, with **62 real browser WebCrypto RNG calls**, independent FROST/k256 and C libsecp256k1 verification in WASM, fresh nonces, consumed-handle and wrong-pair rejection, and distinct BIP341/Unified digests. This browser fixture is not itself a chain-acceptance test; the separate regtest harness provides that proof.

This workspace's Playwright-default revision 1217 was missing. An already-installed revision 1223 was explicitly selected through `WALLET_PLAYWRIGHT_CHROMIUM`, rather than downloading or silently substituting a browser. To reproduce that exact local selection, use Node 22 on PATH and:

```sh
WALLET_PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell" node wallet-mpc/browser-proof.mjs
```

Other browser engines, separate participant devices, coordinator authentication, migrations and complete application wallet flows remain untested here.

## Upstream fixture license

The verbatim `src/unified-vectors.json` fixture comes from [Bitcoin Knots at the pinned commit](https://github.com/bitcoinknots/bitcoin/blob/8c85b1585dac23f964e2dd32045624de7f02aa58/src/test/data/unified_sighash.json). Its upstream `COPYING` notice is:

The MIT License (MIT)

Copyright (c) 2009-2025 The Bitcoin Core developers
Copyright (c) 2009-2025 Bitcoin Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
