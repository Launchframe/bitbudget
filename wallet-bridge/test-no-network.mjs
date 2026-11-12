import net from "node:net"
import tls from "node:tls"
import http from "node:http"
import https from "node:https"
import dns from "node:dns"
import { syncBuiltinESMExports } from "node:module"

const refuse = () => { throw new Error("Unexpected network operation in a network-free test") }
for (const [target, methods] of [[net, ["connect", "createConnection", "createServer"]], [net.Socket.prototype, ["connect"]], [net.Server.prototype, ["listen"]], [tls, ["connect", "createServer"]], [http, ["createServer", "request", "get"]], [https, ["createServer", "request", "get"]], [dns, ["lookup", "resolve"]]]) {
  for (const method of methods) target[method] = refuse
}
syncBuiltinESMExports()
