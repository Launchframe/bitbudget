set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WALLET="$ROOT/wallet-mpc"
RUST_IMAGE='rust:1.94.1-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55'
NODE_IMAGE='node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e'
IMAGE_TAG='bitbudget-wallet-mpc-wasm:rust1.94.1-bindgen0.2.114'

if [ -d /Applications/Docker.app/Contents/Resources/bin ]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

test -f "$WALLET/Cargo.lock"
docker buildx imagetools inspect "$RUST_IMAGE"
docker buildx imagetools inspect "$NODE_IMAGE"
docker build --pull --tag "$IMAGE_TAG" "$WALLET"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
printf 'Wallet build image: %s\n' "$IMAGE_ID"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 \
    "$IMAGE_ID"
ARTIFACT_CONTAINER="$(docker create --network none "$IMAGE_ID")"
trap 'docker rm -f "$ARTIFACT_CONTAINER" >/dev/null' EXIT
docker cp "$ARTIFACT_CONTAINER:/wallet/pkg" "$WALLET/"
printf 'Verified web bindings exported to %s/pkg\n' "$WALLET"
