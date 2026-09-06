set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_IMAGE='bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78'
if [ -d /Applications/Docker.app/Contents/Resources/bin ]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi
docker info >/dev/null
node -e 'if (Date.now() - Date.parse("2025-04-15T12:17:09Z") < 7 * 86400000) process.exit(1)'
docker buildx imagetools inspect "$CORE_IMAGE"
docker pull "$CORE_IMAGE"
bash "$ROOT/scripts/build-wallet-mpc.sh"
RUNNER_IMAGE="$(docker image inspect --format '{{.Id}}' bitbudget-wallet-mpc-wasm:rust1.94.1-bindgen0.2.114)"
RUN_ID="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')"
PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
NETWORK_ID=''
NODE_ID=''
RUNNER_ID=''
cleanup() {
    if [ -n "$RUNNER_ID" ]; then docker rm -fv "$RUNNER_ID" >/dev/null || printf 'Cleanup failed for proof container %s\n' "$RUNNER_ID" >&2; fi
    if [ -n "$NODE_ID" ]; then docker rm -fv "$NODE_ID" >/dev/null || printf 'Cleanup failed for node container %s\n' "$NODE_ID" >&2; fi
    if [ -n "$NETWORK_ID" ]; then docker network rm "$NETWORK_ID" >/dev/null || printf 'Cleanup failed for internal network %s\n' "$NETWORK_ID" >&2; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
NETWORK_ID="$(docker network create --internal --label "wallet-regtest-run=$RUN_ID" "wallet-regtest-$RUN_ID")"
SUBNET="$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "$NETWORK_ID")"
NODE_ID="$(docker create --name "wallet-regtest-node-$RUN_ID" --label "wallet-regtest-run=$RUN_ID" \
    --network "$NETWORK_ID" --network-alias node --user 101:101 --read-only --cap-drop ALL \
    --security-opt no-new-privileges --pids-limit 256 \
    --tmpfs /home/bitcoin/.bitcoin:rw,uid=101,gid=101,mode=0700 \
    --entrypoint bitcoind "$CORE_IMAGE" -regtest=1 -server=1 -txindex=1 \
    -datadir=/home/bitcoin/.bitcoin -listen=0 -listenonion=0 -connect=0 -dnsseed=0 -discover=0 \
    -rpcbind=0.0.0.0:18443 "-rpcallowip=$SUBNET" -rpcuser=wallet-regtest "-rpcpassword=$PASSWORD" \
    -fallbackfee=0.0002 -printtoconsole=1)"
docker start "$NODE_ID" >/dev/null
RUNNER_ID="$(docker create --name "wallet-regtest-proof-$RUN_ID" --label "wallet-regtest-run=$RUN_ID" \
    --network "$NETWORK_ID" --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 \
    -e WALLET_REGTEST_RPC_URL=http://node:18443 -e "WALLET_REGTEST_RPC_PASSWORD=$PASSWORD" \
    "$RUNNER_IMAGE" node --experimental-default-type=module /wallet/regtest.mjs)"
printf 'Regtest resources: node=wallet-regtest-node-%s proof=wallet-regtest-proof-%s network=wallet-regtest-%s\n' "$RUN_ID" "$RUN_ID" "$RUN_ID"
docker start --attach "$RUNNER_ID"
STATUS="$(docker inspect --format '{{.State.ExitCode}}' "$RUNNER_ID")"
if [ "$STATUS" != 0 ]; then
    docker logs --tail 60 "$NODE_ID"
    exit "$STATUS"
fi
printf 'Regtest acceptance passed; removing only this run’s containers and internal network.\n'
