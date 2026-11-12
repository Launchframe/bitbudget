set -eu

export CARGO_TARGET_DIR=/wallet/target/docker
rustc --version
node --version
clang-14 --version
wasm-bindgen --version
cargo test --locked --all-features
cargo build --locked --release --target wasm32-unknown-unknown --features wasm
wasm-bindgen --target web --typescript --out-dir /wallet/pkg \
    /wallet/target/docker/wasm32-unknown-unknown/release/wallet_mpc.wasm
test -s /wallet/pkg/wallet_mpc_bg.wasm
test -s /wallet/pkg/wallet_mpc.js
test -s /wallet/pkg/wallet_mpc.d.ts
sha256sum /wallet/pkg/wallet_mpc_bg.wasm /wallet/pkg/wallet_mpc.js /wallet/pkg/wallet_mpc.d.ts
