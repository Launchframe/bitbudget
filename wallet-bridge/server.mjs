#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { createElectrumBridge } from "./bridge.mjs"
import { parseElectrumTls, parseSocksProxy } from "./upstream-config.mjs"
import { BridgePolicyError, createPolicyGuard } from "./policy.mjs"

const { values } = parseArgs({ options: {
  "upstream-host": { type: "string" }, "upstream-port": { type: "string", default: "50002" },
  "upstream-env": { type: "boolean", default: false }, "require-onion": { type: "boolean", default: false }, "socks-proxy": { type: "string" }, "timeout-ms": { type: "string", default: "60000" },
  "upstream-servername": { type: "string" }, "upstream-ca": { type: "string" }, "policy-file": { type: "string" },
  "origin": { type: "string", multiple: true }, "allow-host": { type: "string", multiple: true },
  "listen": { type: "string", default: "127.0.0.1" }, "port": { type: "string", default: "50004" },
  "loopback-development": { type: "boolean", default: false },
  "tls-cert": { type: "string" }, "tls-key": { type: "string" }, "help": { type: "boolean" },
} })
if (values.help) {
  console.log("Read-only Electrum bridge. Required: --upstream-host HOST --upstream-servername TLS_NAME --origin APP_ORIGIN. Optional: --upstream-port 50002 --upstream-ca PUBLIC_CA_FILE --listen 127.0.0.1 --port 50004. Local HTTP development only: --loopback-development. Otherwise: --tls-cert CERT_FILE --tls-key KEY_FILE --allow-host EXACT_HOST_HEADER. Use --upstream-env instead of --upstream-host to consume ELECTRUM_TLS without printing it; onion endpoints require --socks-proxy socks5h://PROXY_IP:PORT. --require-onion rejects any non-onion setting. --timeout-ms defaults to 60000. No RPC credentials, broadcasting, arbitrary client-selected upstreams, or payload logging are supported.")
  console.log('Local policy: ~/.config/devin/bitbudget-electrum-bridge-policy.json is always checked. Schema: {"version":1,"denySocks":true,"denyOnion":true}. --policy-file FILE and BITBUDGET_BRIDGE_POLICY_FILE add required policy files; they never override a denial. Missing explicit files or invalid policies fail closed. Restart existing instances when activating a policy. This is a per-user application guard, not an OS firewall; containers need a read-only policy mount.')
  console.log('Node ESM: import { createElectrumBridge } from "bitbudget-electrum-bridge"; const bridge = createElectrumBridge(config); const address = await bridge.listen(); await bridge.close(); Node 22+, explicit configuration, no import-time listeners, and no automatic dotenv loading. TypeScript declarations are included.')
} else {
  try {
    if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22 or newer is required")
    if (values["upstream-env"] && values["upstream-host"]) throw new Error("Choose one upstream configuration source")
    const endpoint = values["upstream-env"] ? parseElectrumTls(process.env.ELECTRUM_TLS) : { host: values["upstream-host"], port: Number(values["upstream-port"]) }
    if (values["require-onion"] && !endpoint.host?.endsWith(".onion")) throw new Error("An onion endpoint is required")
    createPolicyGuard({ upstreamHost: endpoint.host, upstreamServername: values["upstream-servername"], socksProxy: values["socks-proxy"], policyFile: values["policy-file"] })()
    const socksProxy = parseSocksProxy(values["socks-proxy"])
    const bridge = createElectrumBridge({
      policyFile: values["policy-file"],
      host: values.listen, port: Number(values.port), mode: values["loopback-development"] ? "loopback-development" : "tls",
      upstreamHost: endpoint.host, upstreamPort: endpoint.port, upstreamServername: values["upstream-servername"], socksProxy, timeoutMs: Number(values["timeout-ms"]),
      upstreamCa: values["upstream-ca"] ? await readFile(values["upstream-ca"]) : undefined,
      allowedOrigins: values.origin, allowedHosts: values["allow-host"],
      tlsCert: values["tls-cert"] ? await readFile(values["tls-cert"]) : undefined,
      tlsKey: values["tls-key"] ? await readFile(values["tls-key"]) : undefined,
    })
    const address = await bridge.listen()
    console.log(JSON.stringify({ service: "bitbudget-electrum-bridge", status: "listening", listen: address.address, port: address.port, mode: values["loopback-development"] ? "loopback-development" : "tls", readOnly: true, upstreamTlsVerification: "required", upstreamRouting: socksProxy ? "socks5-remote-resolution" : "direct-tls", upstreamType: endpoint.host.endsWith(".onion") ? "onion" : "host" }))
    const stop = () => { void bridge.close().then(() => process.exit(0)) }
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  } catch (error) {
    const safe = ["An onion endpoint is required", "Invalid ELECTRUM_TLS setting", "Expected an explicit Electrum TLS endpoint", "Choose one upstream configuration source", "Use socks5h with an explicit proxy IP and port"]
    const reason = error instanceof BridgePolicyError ? `${error.code}: ${error.message}` : error instanceof Error && safe.includes(error.message) ? error.message : "Check explicit configuration, certificate files and port availability"
    console.error(`Bridge startup failed: ${reason}. No credentials or request payloads have been logged.`)
    process.exitCode = 1
  }
}
