// Slidepad helper for macOS.
// A tiny loopback-only HTTP server that the Slidepad web page calls to press real keys and move
// the real mouse. It accepts a fixed vocabulary of commands (slide keys, pointer move, click) and
// only from allow-listed web origins, so no other website can drive this machine through it.

import ApplicationServices
import Foundation
import Network

let version = "1.0.0"
let port: UInt16 = 7421
/// Remote deltas are in reference px; this many of them span the main display's width.
let referenceWidth = 700.0

var allowedOrigins: Set<String> = ["https://armaugustas.github.io"]
/// --no-prompt skips the system Accessibility dialog at launch (useful for scripted checks).
var promptForAccess = true
var args = CommandLine.arguments.dropFirst().makeIterator()
while let arg = args.next() {
    if arg == "--allow-origin", let origin = args.next() { allowedOrigins.insert(origin) }
    if arg == "--no-prompt" { promptForAccess = false }
}

func isAllowedOrigin(_ origin: String) -> Bool {
    if allowedOrigins.contains(origin) { return true }
    // Local development: http://localhost:<port> and http://127.0.0.1:<port>.
    guard let url = URL(string: origin), url.scheme == "http" else { return false }
    return url.host == "localhost" || url.host == "127.0.0.1"
}

// MARK: - Input

func isTrusted(prompt: Bool = false) -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

let keyCodes: [String: CGKeyCode] = [
    "next": 124, // →
    "prev": 123, // ←
    "first": 115, // Home
    "last": 119, // End
    "blank": 11, // B — black screen in Keynote and PowerPoint
    "escape": 53,
]

func press(_ key: CGKeyCode) {
    let source = CGEventSource(stateID: .hidSystemState)
    CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true)?.post(tap: .cghidEventTap)
    CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)?.post(tap: .cghidEventTap)
}

func desktopBounds() -> CGRect {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &displays, &count)
    return displays.map(CGDisplayBounds).reduce(CGRect.null) { $0.union($1) }
}

func cursorLocation() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

func moveMouse(dx: Double, dy: Double) {
    let scale = CGDisplayBounds(CGMainDisplayID()).width / referenceWidth
    let bounds = desktopBounds()
    let current = cursorLocation()
    let target = CGPoint(
        x: min(max(current.x + dx * scale, bounds.minX), bounds.maxX - 1),
        y: min(max(current.y + dy * scale, bounds.minY), bounds.maxY - 1)
    )
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: .left)?
        .post(tap: .cghidEventTap)
}

func click() {
    let at = cursorLocation()
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: at, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: at, mouseButton: .left)?
        .post(tap: .cghidEventTap)
}

func perform(_ command: [String: Any]) {
    switch command["t"] as? String {
    case "move":
        let dx = (command["dx"] as? Double) ?? 0, dy = (command["dy"] as? Double) ?? 0
        if dx.isFinite, dy.isFinite, abs(dx) < 4000, abs(dy) < 4000 { moveMouse(dx: dx, dy: dy) }
    case "click":
        click()
    case "key":
        if let name = command["k"] as? String, let code = keyCodes[name] { press(code) }
    default:
        break
    }
}

// MARK: - HTTP

struct Request {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}

/// Returns nil until the buffer holds a complete request.
func parseRequest(_ buffer: Data) -> Request? {
    guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)),
          let head = String(data: buffer[..<headerEnd.lowerBound], encoding: .utf8) else { return nil }
    var lines = head.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst().split(separator: " ")
    guard requestLine.count >= 2 else { return nil }
    var headers: [String: String] = [:]
    for line in lines {
        guard let colon = line.firstIndex(of: ":") else { continue }
        headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let length = Int(headers["content-length"] ?? "0") ?? 0
    let body = buffer[headerEnd.upperBound...]
    guard body.count >= length else { return nil }
    return Request(method: String(requestLine[0]), path: String(requestLine[1]), headers: headers, body: Data(body.prefix(length)))
}

func respond(_ connection: NWConnection, status: String, origin: String?, json: String? = nil) {
    var head = "HTTP/1.1 \(status)\r\nConnection: close\r\nCache-Control: no-store\r\nVary: Origin\r\n"
    if let origin {
        head += "Access-Control-Allow-Origin: \(origin)\r\n"
        head += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        head += "Access-Control-Allow-Headers: Content-Type\r\n"
        head += "Access-Control-Allow-Private-Network: true\r\n"
        head += "Access-Control-Max-Age: 600\r\n"
    }
    let body = Data((json ?? "").utf8)
    if json != nil { head += "Content-Type: application/json\r\n" }
    head += "Content-Length: \(body.count)\r\n\r\n"
    connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
}

func handle(_ request: Request, on connection: NWConnection) {
    // Reject DNS-rebinding attempts: the browser must be addressing us by a loopback name.
    let host = request.headers["host"] ?? ""
    guard host == "127.0.0.1:\(port)" || host == "localhost:\(port)" else {
        return respond(connection, status: "403 Forbidden", origin: nil)
    }
    let origin = request.headers["origin"]
    if let origin, !isAllowedOrigin(origin) {
        return respond(connection, status: "403 Forbidden", origin: nil)
    }

    switch (request.method, request.path) {
    case ("OPTIONS", _):
        respond(connection, status: "204 No Content", origin: origin)
    case ("GET", "/status"):
        respond(connection, status: "200 OK", origin: origin,
                json: #"{"app":"slidepad-helper","version":"\#(version)","os":"mac","trusted":\#(isTrusted())}"#)
    case ("POST", "/input"):
        // Input must come from an allow-listed page, never from an origin-less client.
        guard origin != nil else { return respond(connection, status: "403 Forbidden", origin: nil) }
        guard isTrusted() else { return respond(connection, status: "409 Conflict", origin: origin, json: #"{"error":"accessibility"}"#) }
        guard let commands = try? JSONSerialization.jsonObject(with: request.body) as? [[String: Any]] else {
            return respond(connection, status: "400 Bad Request", origin: origin)
        }
        commands.prefix(64).forEach(perform)
        respond(connection, status: "204 No Content", origin: origin)
    default:
        respond(connection, status: "404 Not Found", origin: origin)
    }
}

func receive(on connection: NWConnection, buffer: Data = Data()) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
        var buffer = buffer
        if let data { buffer.append(data) }
        if let request = parseRequest(buffer) { return handle(request, on: connection) }
        if error != nil || isComplete || buffer.count > 65536 { return connection.cancel() }
        receive(on: connection, buffer: buffer)
    }
}

// MARK: - Main

setvbuf(stdout, nil, _IOLBF, 0)

let parameters = NWParameters.tcp
parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
parameters.allowLocalEndpointReuse = true

let listener: NWListener
do {
    listener = try NWListener(using: parameters)
} catch {
    print("  ✗ Couldn’t open port \(port): \(error)")
    exit(1)
}

func line(_ text: String = "") { print("  " + text) }

listener.newConnectionHandler = { connection in
    connection.start(queue: .main)
    receive(on: connection)
}
listener.stateUpdateHandler = { state in
    switch state {
    case .ready:
        line()
        line("slidepad helper \(version)")
        line()
        line("✓ Ready — your browser tab will find this automatically.")
        if isTrusted(prompt: promptForAccess) {
            line("✓ Accessibility permission granted.")
        } else {
            line("! One more step: allow this to press keys for you.")
            line("  System Settings → Privacy & Security → Accessibility → turn on Terminal.")
            waitForTrust()
        }
        line()
        line("Keep this window open while presenting. Press Ctrl+C to stop.")
        line()
    case .failed(let error):
        if case .posix(let code) = error, code == .EADDRINUSE {
            line("✗ Port \(port) is already in use — is another Slidepad helper running?")
        } else {
            line("✗ \(error)")
        }
        exit(1)
    default:
        break
    }
}

func waitForTrust() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        if isTrusted() { line("✓ Accessibility permission granted — you’re all set.") } else { waitForTrust() }
    }
}

signal(SIGINT) { _ in
    print("\n  Stopped. Nothing was installed, so there’s nothing to clean up.\n")
    exit(0)
}

listener.start(queue: .main)
dispatchMain()
