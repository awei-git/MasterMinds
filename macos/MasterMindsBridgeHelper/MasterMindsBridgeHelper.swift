import AppKit
import Foundation

private let apiURL = URL(string: "http://127.0.0.1:3000")!
private let bridgeFolderName = "MasterMinds-Bridge"
private let pollInterval: TimeInterval = 5

@main
final class MasterMindsBridgeHelper: NSObject, NSApplicationDelegate {
    private var bridgeURL: URL?
    private var shouldStop = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        do {
            let url = try resolveBridgeFolder()
            bridgeURL = url
            _ = url.startAccessingSecurityScopedResource()
            try BridgeWorker(root: url).prepareFolders()
            startWorker(url)
        } catch {
            showError(error)
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        shouldStop = true
        bridgeURL?.stopAccessingSecurityScopedResource()
    }

    private func startWorker(_ url: URL) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let worker = BridgeWorker(root: url)
            while self?.shouldStop == false {
                do {
                    let count = try worker.processOnce()
                    if count > 0 {
                        NSLog("MasterMinds bridge processed \(count) command(s)")
                    }
                } catch {
                    NSLog("MasterMinds bridge error: \(error)")
                }
                Thread.sleep(forTimeInterval: pollInterval)
            }
        }
    }

    private func resolveBridgeFolder() throws -> URL {
        if let url = try loadBookmarkedFolder() {
            return url
        }
        if FileManager.default.fileExists(atPath: Self.defaultCloudDocsBridgeURL.path) {
            return Self.defaultCloudDocsBridgeURL
        }
        return try chooseBridgeFolder()
    }

    private func loadBookmarkedFolder() throws -> URL? {
        let bookmarkURL = Self.bookmarkURL
        guard FileManager.default.fileExists(atPath: bookmarkURL.path) else { return nil }
        let data = try Data(contentsOf: bookmarkURL)
        var stale = false
        let url = try URL(
            resolvingBookmarkData: data,
            options: [.withSecurityScope],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        )
        if stale {
            try saveBookmark(for: url)
        }
        return normalizedBridgeURL(url)
    }

    private func chooseBridgeFolder() throws -> URL {
        let panel = NSOpenPanel()
        panel.title = "Choose the MasterMinds-Bridge folder in iCloud Drive"
        panel.message = "Select iCloud Drive / MasterMinds-Bridge so the helper can sync iPhone commands with the local server."
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.directoryURL = Self.defaultCloudDocsBridgeURL.deletingLastPathComponent()

        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let selected = panel.url else {
            throw BridgeError.cancelled
        }

        let url = normalizedBridgeURL(selected)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try saveBookmark(for: url)
        return url
    }

    private func normalizedBridgeURL(_ url: URL) -> URL {
        if url.lastPathComponent == bridgeFolderName {
            return url
        }
        return url.appendingPathComponent(bridgeFolderName, isDirectory: true)
    }

    private func saveBookmark(for url: URL) throws {
        try FileManager.default.createDirectory(at: Self.supportURL, withIntermediateDirectories: true)
        let data = try url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        try data.write(to: Self.bookmarkURL, options: [.atomic])
    }

    private func showError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "MasterMinds Bridge Helper could not start"
        alert.informativeText = String(describing: error)
        alert.alertStyle = .warning
        alert.runModal()
    }

    private static var supportURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/MasterMindsBridgeHelper", isDirectory: true)
    }

    private static var bookmarkURL: URL {
        supportURL.appendingPathComponent("bridge-folder.bookmark")
    }

    private static var defaultCloudDocsBridgeURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
            .appendingPathComponent(bridgeFolderName, isDirectory: true)
    }
}

private struct BridgeWorker {
    let root: URL
    private let fileManager = FileManager.default
    private let isoFormatter = ISO8601DateFormatter()

    func prepareFolders() throws {
        for folder in ["commands", "responses", "processed"] {
            try fileManager.createDirectory(at: root.appendingPathComponent(folder, isDirectory: true), withIntermediateDirectories: true)
        }
    }

    func processOnce() throws -> Int {
        try prepareFolders()
        try? writeHeartbeat()

        let commandsURL = root.appendingPathComponent("commands", isDirectory: true)
        let files = try fileManager.contentsOfDirectory(
            at: commandsURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        for file in files {
            process(file)
        }
        return files.count
    }

    private func process(_ file: URL) {
        let commandID = file.deletingPathExtension().lastPathComponent
        let responseURL = root
            .appendingPathComponent("responses", isDirectory: true)
            .appendingPathComponent("\(commandID).json")
        let processedURL = root
            .appendingPathComponent("processed", isDirectory: true)
            .appendingPathComponent(file.lastPathComponent)

        let response: [String: Any]
        do {
            let command = try readObject(file)
            let id = command["id"] as? String ?? commandID
            let data = try handle(command)
            response = ["id": id, "status": "ok", "data": data, "updatedAt": now()]
        } catch {
            response = ["id": commandID, "status": "error", "error": String(describing: error), "updatedAt": now()]
        }

        do {
            try writeObject(response, to: responseURL)
            if fileManager.fileExists(atPath: processedURL.path) {
                try fileManager.removeItem(at: processedURL)
            }
            try fileManager.moveItem(at: file, to: processedURL)
        } catch {
            NSLog("MasterMinds bridge could not finish \(file.lastPathComponent): \(error)")
        }
    }

    private func handle(_ command: [String: Any]) throws -> Any {
        guard let action = command["action"] as? String else {
            throw BridgeError.invalidCommand("missing action")
        }
        let payload = command["payload"] as? [String: Any] ?? [:]

        switch action {
        case "projects.list":
            return try requestJSON("GET", "/api/projects")
        case "projects.create":
            return try requestJSON("POST", "/api/projects", body: payload)
        case "projects.setPhase":
            return try requestJSON("PATCH", "/api/projects", body: [
                "slug": try string(payload, "slug"),
                "action": "setPhase",
                "phase": try string(payload, "phase"),
            ])
        case "phases.summary":
            return try requestJSON("GET", "/api/phases", query: [
                "projectSlug": try string(payload, "projectSlug"),
                "phase": try string(payload, "phase"),
            ])
        case "chapters.list":
            return try requestJSON("GET", "/api/beats", query: [
                "projectSlug": try string(payload, "projectSlug"),
                "unit": "chapter",
            ])
        case "chapterDraft.get":
            return try requestJSON("GET", "/api/writing-tasks", query: [
                "projectSlug": try string(payload, "projectSlug"),
                "kind": "chapter_draft",
                "chapterId": try string(payload, "chapterId"),
            ])
        case "chapterDraft.save":
            return try requestJSON("PATCH", "/api/writing-tasks", body: payload)
        case "writingTask.run":
            return try requestJSON("POST", "/api/writing-tasks", body: payload, timeout: 900)
        case "roundtable.run":
            return try requestSSE("/api/roundtable", body: payload, timeout: 1_200)
        default:
            throw BridgeError.invalidCommand("unknown action \(action)")
        }
    }

    private func requestJSON(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: Any? = nil,
        timeout: TimeInterval = 180
    ) throws -> Any {
        let data = try request(method, path, query: query, body: body, accept: "application/json", timeout: timeout)
        if data.isEmpty { return [:] }
        return try JSONSerialization.jsonObject(with: data)
    }

    private func requestSSE(_ path: String, body: Any, timeout: TimeInterval) throws -> [[String: Any]] {
        let data = try request("POST", path, body: body, accept: "text/event-stream", timeout: timeout)
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        var events: [[String: Any]] = []
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("data:") else { continue }
            let payload = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            if payload.isEmpty || payload == "[DONE]" { continue }
            guard
                let eventData = payload.data(using: .utf8),
                let event = try JSONSerialization.jsonObject(with: eventData) as? [String: Any]
            else { continue }
            events.append(event)
            if let type = event["type"] as? String, type == "done" || type == "error" {
                break
            }
        }
        return events
    }

    private func request(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: Any? = nil,
        accept: String,
        timeout: TimeInterval
    ) throws -> Data {
        var components = URLComponents(url: apiURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else {
            throw BridgeError.invalidCommand("invalid URL")
        }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        var result: Result<(Data, URLResponse), Error>?
        let semaphore = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                result = .failure(error)
            } else {
                result = .success((data ?? Data(), response!))
            }
            semaphore.signal()
        }.resume()

        if semaphore.wait(timeout: .now() + timeout) == .timedOut {
            throw BridgeError.requestFailed("request timed out")
        }

        let (data, response) = try result!.get()
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw BridgeError.requestFailed(message)
        }
        return data
    }

    private func writeHeartbeat() throws {
        try writeObject([
            "status": "online",
            "updatedAt": now(),
            "apiURL": apiURL.absoluteString,
            "helper": "macos",
        ], to: root.appendingPathComponent("heartbeat.json"))
    }

    private func readObject(_ url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BridgeError.invalidCommand("command is not a JSON object")
        }
        return object
    }

    private func writeObject(_ object: [String: Any], to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: [.atomic])
    }

    private func now() -> String {
        isoFormatter.string(from: Date())
    }

    private func string(_ payload: [String: Any], _ key: String) throws -> String {
        guard let value = payload[key] as? String else {
            throw BridgeError.invalidCommand("missing \(key)")
        }
        return value
    }
}

private enum BridgeError: Error, CustomStringConvertible {
    case cancelled
    case invalidCommand(String)
    case requestFailed(String)

    var description: String {
        switch self {
        case .cancelled:
            return "Bridge folder selection was cancelled."
        case .invalidCommand(let message), .requestFailed(let message):
            return message
        }
    }
}
