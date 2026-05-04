import Foundation

struct ChapterDraftCache: Codable, Hashable {
    let projectSlug: String
    let chapterId: String
    var content: String
    var path: String?
    var updatedAt: Date
}

struct WritingCacheSnapshot: Codable {
    var projects: [String: Project] = [:]
    var chapters: [String: [ChapterUnit]] = [:]
    var chapterDrafts: [String: ChapterDraftCache] = [:]
}

@MainActor
final class CloudWritingStore {
    static let containerIdentifier = "iCloud.com.angwei.shenxianhui"

    private static let keyValueSnapshotKey = "com.angwei.shenxianhui.writing-cache.v1"
    private static let keyValueSnapshotLimit = 900_000

    private let cacheURL: URL
    private var lastSyncError: String?

    init(fileManager: FileManager = .default) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        let folder = base.appendingPathComponent("MasterMindsIOS", isDirectory: true)
        try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        cacheURL = folder.appendingPathComponent("writing-cache.json")
    }

    func accountStatusDescription() async -> String? {
        guard isICloudKeyValueStoreAvailable else {
            return "未登录 iCloud 或 iCloud Drive 不可用"
        }
        return nil
    }

    func projects() async -> [Project] {
        var snapshot = loadSnapshot()
        if let cloudSnapshot = loadKeyValueSnapshot() {
            for project in cloudSnapshot.projects.values {
                snapshot.projects[project.slug] = project
            }
            for (slug, chapters) in cloudSnapshot.chapters {
                snapshot.chapters[slug] = chapters
            }
            for (key, draft) in cloudSnapshot.chapterDrafts {
                snapshot.chapterDrafts[key] = draft
            }
            saveSnapshot(snapshot)
        }
        return snapshot.projects.values.sorted { $0.updatedAt > $1.updatedAt }
    }

    @discardableResult
    func upsertProjects(_ projects: [Project], syncToCloud: Bool) async -> Bool {
        var snapshot = loadSnapshot()
        for project in projects {
            snapshot.projects[project.slug] = project
        }
        saveSnapshot(snapshot)

        guard syncToCloud else { return true }
        return saveKeyValueSnapshot(snapshot)
    }

    func createProject(title: String, type: String) async -> Project {
        let now = Date()
        let slug = uniqueSlug(for: title)
        let project = Project(
            id: "icloud-\(UUID().uuidString)",
            slug: slug,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            type: type,
            phase: "conception",
            status: "active",
            updatedAt: now
        )
        await upsertProjects([project], syncToCloud: true)
        return project
    }

    func setPhase(slug: String, phase: String) async throws -> Project {
        var snapshot = loadSnapshot()
        guard let existing = snapshot.projects[slug] else {
            throw APIClientError.server("本地/iCloud 中找不到项目：\(slug)")
        }
        let project = Project(
            id: existing.id,
            slug: existing.slug,
            title: existing.title,
            type: existing.type,
            phase: phase,
            status: existing.status,
            updatedAt: Date()
        )
        snapshot.projects[slug] = project
        saveSnapshot(snapshot)
        if isICloudKeyValueStoreAvailable {
            _ = saveKeyValueSnapshot(snapshot)
        }
        return project
    }

    func chapters(projectSlug: String) async -> [ChapterUnit] {
        var snapshot = loadSnapshot()
        if let cloudSnapshot = loadKeyValueSnapshot() {
            for (slug, chapters) in cloudSnapshot.chapters {
                snapshot.chapters[slug] = chapters
            }
            for (key, draft) in cloudSnapshot.chapterDrafts {
                snapshot.chapterDrafts[key] = draft
            }
            saveSnapshot(snapshot)
        }
        return snapshot.chapters[projectSlug] ?? []
    }

    @discardableResult
    func upsertChapters(_ chapters: [ChapterUnit], projectSlug: String, syncToCloud: Bool) async -> Bool {
        var snapshot = loadSnapshot()
        snapshot.chapters[projectSlug] = chapters
        saveSnapshot(snapshot)

        guard syncToCloud else { return true }
        return saveKeyValueSnapshot(snapshot)
    }

    func chapterDraft(projectSlug: String, chapterId: String) async -> ChapterDraftCache? {
        var snapshot = loadSnapshot()
        if let cloudSnapshot = loadKeyValueSnapshot() {
            for (key, draft) in cloudSnapshot.chapterDrafts {
                snapshot.chapterDrafts[key] = draft
            }
            saveSnapshot(snapshot)
        }
        return snapshot.chapterDrafts[draftKey(projectSlug: projectSlug, chapterId: chapterId)]
    }

    func saveChapterDraft(projectSlug: String, chapterId: String, content: String, path: String? = nil) async -> ChapterDraftCache {
        var snapshot = loadSnapshot()
        let key = draftKey(projectSlug: projectSlug, chapterId: chapterId)
        let draft = ChapterDraftCache(
            projectSlug: projectSlug,
            chapterId: chapterId,
            content: content,
            path: path ?? "iCloud://\(projectSlug)/chapters/\(chapterId)",
            updatedAt: Date()
        )
        snapshot.chapterDrafts[key] = draft
        saveSnapshot(snapshot)
        if isICloudKeyValueStoreAvailable {
            _ = saveKeyValueSnapshot(snapshot)
        }
        return draft
    }

    func syncIssueDescription() -> String {
        if let lastSyncError, !lastSyncError.isEmpty {
            return "iCloud 未同步：\(lastSyncError)"
        }
        return "iCloud 未同步；已保存到本地缓存"
    }

    private var isICloudKeyValueStoreAvailable: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return FileManager.default.ubiquityIdentityToken != nil
        #endif
    }

    private func loadKeyValueSnapshot() -> WritingCacheSnapshot? {
        guard isICloudKeyValueStoreAvailable else { return nil }
        let store = NSUbiquitousKeyValueStore.default
        store.synchronize()
        guard let data = store.data(forKey: Self.keyValueSnapshotKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(WritingCacheSnapshot.self, from: data)
    }

    private func saveKeyValueSnapshot(_ snapshot: WritingCacheSnapshot) -> Bool {
        guard isICloudKeyValueStoreAvailable else {
            lastSyncError = "未登录 iCloud 或 iCloud Drive 不可用"
            return false
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot) else {
            lastSyncError = "本地写作快照编码失败"
            return false
        }
        guard data.count <= Self.keyValueSnapshotLimit else {
            lastSyncError = "iCloud Key-Value Store 快照超过 \(Self.keyValueSnapshotLimit / 1000)KB；需要绑定 CloudKit container 后才能同步更大的稿件"
            return false
        }

        let store = NSUbiquitousKeyValueStore.default
        store.set(data, forKey: Self.keyValueSnapshotKey)
        let didSync = store.synchronize()
        lastSyncError = didSync ? nil : "iCloud 暂时没有接受同步请求"
        return didSync
    }

    private func loadSnapshot() -> WritingCacheSnapshot {
        guard let data = try? Data(contentsOf: cacheURL) else {
            return WritingCacheSnapshot()
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode(WritingCacheSnapshot.self, from: data)) ?? WritingCacheSnapshot()
    }

    private func saveSnapshot(_ snapshot: WritingCacheSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(snapshot) else { return }
        try? data.write(to: cacheURL, options: [.atomic])
    }

    private func uniqueSlug(for title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let ascii = trimmed
            .lowercased()
            .unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) ? Character($0) : "-" }
        let base = String(ascii)
            .split(separator: "-")
            .joined(separator: "-")
        return base.isEmpty ? trimmed : "\(base)-\(UUID().uuidString.prefix(6))"
    }

    private func draftKey(projectSlug: String, chapterId: String) -> String {
        "\(projectSlug)::\(chapterId)"
    }

}

private struct EmptyBridgePayload: Encodable {}

private struct BridgeCommand<Payload: Encodable>: Encodable {
    let id: String
    let action: String
    let createdAt: Date
    let payload: Payload
}

private struct BridgeCreateProjectPayload: Encodable {
    let title: String
    let type: String
}

private struct BridgeSetPhasePayload: Encodable {
    let slug: String
    let phase: String
}

private struct BridgeProjectPayload: Encodable {
    let projectSlug: String
}

private struct BridgeChapterPayload: Encodable {
    let projectSlug: String
    let chapterId: String
}

private struct BridgeSaveDraftPayload: Encodable {
    let projectSlug: String
    let chapterId: String
    let content: String
}

private struct BridgePhasePayload: Encodable {
    let projectSlug: String
    let phase: String
}

private struct BridgeWritingTaskPayload: Encodable {
    let projectSlug: String
    let kind: String
    let chapterId: String?
    let instruction: String?
    let providerSettings: ModelProviderSettings
    let writingLanguage: String
}

private struct BridgeRoundtablePayload: Encodable {
    let projectSlug: String
    let phase: String
    let topic: String
    let maxRounds: Int
    let generateSummary: Bool
    let providerSettings: ModelProviderSettings
    let writingLanguage: String
    let discussionId: String?
    let humanInterjection: String?
}

@MainActor
final class ICloudBridgeClient {
    private static let bridgeFolderName = "MasterMinds-Bridge"
    private static let bridgeBookmarkKey = "masterminds.icloudBridgeFolderBookmark"
    private let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    var isAvailable: Bool {
        bridgeRootURL != nil
    }

    var configuredFolderName: String? {
        bridgeRootURL?.lastPathComponent
    }

    func setBridgeFolder(_ url: URL) throws {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess { url.stopAccessingSecurityScopedResource() }
        }
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        for folder in ["commands", "responses", "processed"] {
            try fileManager.createDirectory(at: url.appendingPathComponent(folder, isDirectory: true), withIntermediateDirectories: true)
        }
        let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(bookmark, forKey: Self.bridgeBookmarkKey)
    }

    func projects() async throws -> [Project] {
        try await request(action: "projects.list", payload: EmptyBridgePayload(), timeout: 90)
    }

    func createProject(title: String, type: String) async throws -> Project {
        try await request(action: "projects.create", payload: BridgeCreateProjectPayload(title: title, type: type), timeout: 120)
    }

    func setPhase(slug: String, phase: String) async throws -> Project {
        try await request(action: "projects.setPhase", payload: BridgeSetPhasePayload(slug: slug, phase: phase), timeout: 120)
    }

    func phaseSummary(projectSlug: String, phase: String) async throws -> String? {
        let response: PhaseSummaryResponse = try await request(
            action: "phases.summary",
            payload: BridgePhasePayload(projectSlug: projectSlug, phase: phase),
            timeout: 120
        )
        return response.content
    }

    func chapters(projectSlug: String) async throws -> [ChapterUnit] {
        let response: ChapterListResponse = try await request(
            action: "chapters.list",
            payload: BridgeProjectPayload(projectSlug: projectSlug),
            timeout: 120
        )
        return response.beats
    }

    func chapterDraft(projectSlug: String, chapterId: String) async throws -> SavedArtifactResponse {
        try await request(
            action: "chapterDraft.get",
            payload: BridgeChapterPayload(projectSlug: projectSlug, chapterId: chapterId),
            timeout: 120
        )
    }

    func saveChapterDraft(projectSlug: String, chapterId: String, content: String) async throws -> SaveArtifactResponse {
        try await request(
            action: "chapterDraft.save",
            payload: BridgeSaveDraftPayload(projectSlug: projectSlug, chapterId: chapterId, content: content),
            timeout: 120
        )
    }

    func runWritingTask(
        projectSlug: String,
        kind: String,
        chapterId: String?,
        instruction: String?,
        providerSettings: ModelProviderSettings,
        writingLanguage: String
    ) async throws -> WritingTaskResult {
        try await request(
            action: "writingTask.run",
            payload: BridgeWritingTaskPayload(
                projectSlug: projectSlug,
                kind: kind,
                chapterId: chapterId,
                instruction: instruction,
                providerSettings: providerSettings,
                writingLanguage: writingLanguage
            ),
            timeout: 900
        )
    }

    func roundtable(
        projectSlug: String,
        phase: String,
        topic: String,
        maxRounds: Int,
        generateSummary: Bool,
        providerSettings: ModelProviderSettings,
        writingLanguage: String,
        discussionId: String?,
        humanInterjection: String?
    ) async throws -> [RoundtableEvent] {
        try await request(
            action: "roundtable.run",
            payload: BridgeRoundtablePayload(
                projectSlug: projectSlug,
                phase: phase,
                topic: topic,
                maxRounds: maxRounds,
                generateSummary: generateSummary,
                providerSettings: providerSettings,
                writingLanguage: writingLanguage,
                discussionId: discussionId,
                humanInterjection: humanInterjection
            ),
            timeout: 1_200
        )
    }

    private var bridgeRootURL: URL? {
        guard let bookmark = UserDefaults.standard.data(forKey: Self.bridgeBookmarkKey) else { return nil }
        var stale = false
        guard
            let url = try? URL(
                resolvingBookmarkData: bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
        else { return nil }
        _ = url.startAccessingSecurityScopedResource()
        return url.lastPathComponent == Self.bridgeFolderName
            ? url
            : url.appendingPathComponent(Self.bridgeFolderName, isDirectory: true)
    }

    private func request<T: Decodable, Payload: Encodable>(
        action: String,
        payload: Payload,
        timeout: TimeInterval
    ) async throws -> T {
        guard let root = bridgeRootURL else {
            throw APIClientError.server("iCloud Drive 容器不可用")
        }

        let id = "ios-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString)"
        let command = BridgeCommand(id: id, action: action, createdAt: Date(), payload: payload)
        let commandURL = root
            .appendingPathComponent("commands", isDirectory: true)
            .appendingPathComponent("\(id).json")
        let responseURL = root
            .appendingPathComponent("responses", isDirectory: true)
            .appendingPathComponent("\(id).json")

        try write(command, to: commandURL)
        return try await waitForResponse(responseURL, timeout: timeout)
    }

    private func write<Payload: Encodable>(_ command: BridgeCommand<Payload>, to url: URL) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(command)
        let tempURL = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).tmp")
        try data.write(to: tempURL, options: [.atomic])
        if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
        try fileManager.moveItem(at: tempURL, to: url)
    }

    private func waitForResponse<T: Decodable>(_ url: URL, timeout: TimeInterval) async throws -> T {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if fileManager.fileExists(atPath: url.path) {
                try? fileManager.startDownloadingUbiquitousItem(at: url)
                let data = try Data(contentsOf: url)
                let decoded: T = try decodeResponse(data)
                try? fileManager.removeItem(at: url)
                return decoded
            }
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
        throw APIClientError.server("iCloud Bridge 等待 Mac 返回超时")
    }

    private func decodeResponse<T: Decodable>(_ data: Data) throws -> T {
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw APIClientError.server("iCloud Bridge 返回格式错误")
        }
        if let error = object["error"] as? String, !error.isEmpty {
            throw APIClientError.server(error)
        }
        let status = object["status"] as? String
        if status != nil, status != "ok" {
            throw APIClientError.server("iCloud Bridge 返回失败")
        }
        let dataObject = object["data"] ?? [:]
        let responseData = try JSONSerialization.data(withJSONObject: dataObject)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(T.self, from: responseData)
    }
}
