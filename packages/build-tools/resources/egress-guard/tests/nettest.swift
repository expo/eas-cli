// Probe run inside a simulator by the egress guard end-to-end test. Exercises
// every outbound path the guard must cover and prints one JSON object.
//
//   nettest --proxy-port <port> --udp-port <port>
//
// proxy-port: a CONNECT proxy on the host's loopback, standing in for the
// egress proxy. udp-port: a UDP echo on loopback.
import Foundation
import Network

var results: [String: String] = [:]
let args = CommandLine.arguments
func arg(_ name: String) -> Int {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return 0 }
  return Int(args[i + 1]) ?? 0
}
let proxyPort = arg("--proxy-port")
let udpPort = arg("--udp-port")
let remoteHost = "example.com"
let remotePort = 443

func classify(_ error: Error?) -> String {
  guard let e = error as NSError? else { return "ok" }
  if e.domain == NSURLErrorDomain && e.code == NSURLErrorCannotConnectToHost { return "refused" }
  if e.domain == NSPOSIXErrorDomain && e.code == Int(ECONNREFUSED) { return "refused" }
  return "error(\(e.domain):\(e.code))"
}

// 1. URLSession straight to the internet. Blocked by the guard.
func urlSessionDirect() {
  let g = DispatchGroup(); g.enter()
  let c = URLSessionConfiguration.ephemeral; c.timeoutIntervalForRequest = 10
  c.connectionProxyDictionary = [:]  // explicitly no proxy, even if the host has one
  URLSession(configuration: c).dataTask(with: URL(string: "https://\(remoteHost)/")!) { _, r, e in
    results["urlsessionDirect"] = e == nil ? "ok(\((r as? HTTPURLResponse)?.statusCode ?? 0))" : classify(e); g.leave()
  }.resume(); g.wait()
}

// 2. URLSession through a CONNECT proxy on loopback. Allowed: the guard only
// sees a loopback connect.
func urlSessionProxied() {
  let g = DispatchGroup(); g.enter()
  let c = URLSessionConfiguration.ephemeral; c.timeoutIntervalForRequest = 15
  // The kCFNetworkProxies* constants are not exposed to Swift on iOS; these are their values.
  c.connectionProxyDictionary = ["HTTPSEnable": 1, "HTTPSProxy": "127.0.0.1", "HTTPSPort": proxyPort]
  URLSession(configuration: c).dataTask(with: URL(string: "https://\(remoteHost)/")!) { _, r, e in
    results["urlsessionProxied"] = e == nil ? "ok(\((r as? HTTPURLResponse)?.statusCode ?? 0))" : classify(e); g.leave()
  }.resume(); g.wait()
}

// 3. Network.framework connection straight out. Blocked.
func nwConnectionDirect() {
  let g = DispatchGroup(); g.enter()
  let p = NWParameters.tls; p.preferNoProxies = true
  let c = NWConnection(host: NWEndpoint.Host(remoteHost), port: NWEndpoint.Port(integerLiteral: UInt16(remotePort)), using: p)
  var done = false
  c.stateUpdateHandler = { s in
    guard !done else { return }
    switch s {
    case .ready: done = true; results["nwconnectionDirect"] = "ok"; c.cancel(); g.leave()
    case .failed(let e): done = true; results["nwconnectionDirect"] = classify(e); g.leave()
    case .waiting(let e): done = true; results["nwconnectionDirect"] = "waiting(" + classify(e) + ")"; c.cancel(); g.leave()
    default: break
    }
  }
  c.start(queue: .global())
  _ = g.wait(timeout: .now() + 15)
  if results["nwconnectionDirect"] == nil { results["nwconnectionDirect"] = "timeout"; c.cancel() }
}

// 4. Plain BSD TCP connect to a resolved address. Blocked.
func bsdConnectDirect() {
  var hints = addrinfo(); hints.ai_socktype = SOCK_STREAM; hints.ai_family = AF_INET
  var info: UnsafeMutablePointer<addrinfo>? = nil
  guard getaddrinfo(remoteHost, "443", &hints, &info) == 0, let ai = info else { results["bsdConnectDirect"] = "dns-failed"; return }
  results["dns"] = "ok"
  let fd = socket(ai.pointee.ai_family, ai.pointee.ai_socktype, ai.pointee.ai_protocol)
  let rc = connect(fd, ai.pointee.ai_addr, ai.pointee.ai_addrlen)
  results["bsdConnectDirect"] = rc == 0 ? "ok" : (errno == ECONNREFUSED ? "refused" : "errno(\(errno))")
  close(fd); freeaddrinfo(info)
}

// 5. UDP datagram straight out. Blocked. 6. UDP datagram to loopback echo. Allowed.
func udp(_ key: String, _ host: String, _ port: Int, expectEcho: Bool) {
  let fd = socket(AF_INET, SOCK_DGRAM, 0)
  var to = sockaddr_in(); to.sin_family = sa_family_t(AF_INET); to.sin_port = in_port_t(UInt16(port)).bigEndian
  inet_pton(AF_INET, host, &to.sin_addr)
  var payload: [UInt8] = Array("ping".utf8)
  let sent = withUnsafePointer(to: &to) { p in p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
    sendto(fd, &payload, payload.count, 0, sa, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
  if sent < 0 { results[key] = errno == ECONNREFUSED ? "refused" : "errno(\(errno))"; close(fd); return }
  if expectEcho {
    var tv = timeval(tv_sec: 3, tv_usec: 0); setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var buf = [UInt8](repeating: 0, count: 16)
    let n = recv(fd, &buf, buf.count, 0)
    results[key] = n > 0 ? "ok" : "no-echo"
  } else { results[key] = "sent" }
  close(fd)
}

urlSessionDirect()
urlSessionProxied()
nwConnectionDirect()
bsdConnectDirect()
udp("udpDirect", "8.8.8.8", 53, expectEcho: false)
udp("udpLoopback", "127.0.0.1", udpPort, expectEcho: true)

// 7. The same literal destination twice: the guard must log it once per process.
func bsdConnectLiteral(_ key: String) {
  var to = sockaddr_in(); to.sin_family = sa_family_t(AF_INET); to.sin_port = in_port_t(UInt16(443)).bigEndian
  inet_pton(AF_INET, "1.1.1.1", &to.sin_addr)
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  let rc = withUnsafePointer(to: &to) { p in p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
    connect(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
  results[key] = rc == 0 ? "ok" : (errno == ECONNREFUSED ? "refused" : "errno(\(errno))")
  close(fd)
}
bsdConnectLiteral("literalFirst")
bsdConnectLiteral("literalSecond")

let json = try! JSONSerialization.data(withJSONObject: results, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
