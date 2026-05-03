import CloudKit
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

    private var container: CKContainer { CKContainer(identifier: Self.containerIdentifier) }
    private var database: CKDatabase { container.privateCloudDatabase }
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

    private func recordName(_ parts: String...) -> String {
        let raw = parts.joined(separator: "::")
        let encoded = Data(raw.utf8).base64EncodedString()
        return encoded
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
    }

    private func saveProjectRecord(_ project: Project) async throws {
        let record = CKRecord(
            recordType: "MMProject",
            recordID: CKRecord.ID(recordName: recordName("project", project.slug))
        )
        record["projectId"] = project.id as NSString
        record["slug"] = project.slug as NSString
        record["title"] = project.title as NSString
        record["type"] = project.type as NSString
        record["phase"] = project.phase as NSString
        record["status"] = project.status as NSString
        record["updatedAt"] = project.updatedAt as NSDate
        _ = try await database.save(record)
    }

    private func fetchCloudProjects() async throws -> [Project] {
        let records = try await performQuery(recordType: "MMProject", predicate: NSPredicate(value: true))
        return records.compactMap { record in
            guard
                let id = record["projectId"] as? String,
                let slug = record["slug"] as? String,
                let title = record["title"] as? String,
                let type = record["type"] as? String,
                let phase = record["phase"] as? String,
                let status = record["status"] as? String,
                let updatedAt = record["updatedAt"] as? Date
            else { return nil }
            return Project(id: id, slug: slug, title: title, type: type, phase: phase, status: status, updatedAt: updatedAt)
        }
    }

    private func saveChapterRecord(_ chapter: ChapterUnit, projectSlug: String) async throws {
        let record = CKRecord(
            recordType: "MMChapter",
            recordID: CKRecord.ID(recordName: recordName("chapter", projectSlug, chapter.id))
        )
        record["projectSlug"] = projectSlug as NSString
        record["chapterId"] = chapter.id as NSString
        record["chapter"] = chapter.chapter as NSString
        record["title"] = chapter.title as NSString
        record["summary"] = chapter.summary as NSString
        record["key"] = NSNumber(value: chapter.key)
        record["wordBudget"] = NSNumber(value: chapter.wordBudget)
        record["status"] = chapter.status as NSString
        if let wordCount = chapter.wordCount {
            record["wordCount"] = NSNumber(value: wordCount)
        }
        _ = try await database.save(record)
    }

    private func fetchCloudChapters(projectSlug: String) async throws -> [ChapterUnit] {
        let predicate = NSPredicate(format: "projectSlug == %@", projectSlug)
        let records = try await performQuery(recordType: "MMChapter", predicate: predicate)
        return records.compactMap { record in
            guard
                let id = record["chapterId"] as? String,
                let chapter = record["chapter"] as? String,
                let title = record["title"] as? String,
                let summary = record["summary"] as? String,
                let key = record["key"] as? Bool,
                let wordBudget = record["wordBudget"] as? Int,
                let status = record["status"] as? String
            else { return nil }
            return ChapterUnit(
                id: id,
                chapter: chapter,
                title: title,
                summary: summary,
                key: key,
                wordBudget: wordBudget,
                status: status,
                wordCount: record["wordCount"] as? Int
            )
        }
        .sorted { $0.chapter.localizedStandardCompare($1.chapter) == .orderedAscending }
    }

    private func saveDraftRecord(_ draft: ChapterDraftCache) async throws {
        let record = CKRecord(
            recordType: "MMChapterDraft",
            recordID: CKRecord.ID(recordName: recordName("draft", draft.projectSlug, draft.chapterId))
        )
        record["projectSlug"] = draft.projectSlug as NSString
        record["chapterId"] = draft.chapterId as NSString
        record["content"] = draft.content as NSString
        record["path"] = (draft.path ?? "") as NSString
        record["updatedAt"] = draft.updatedAt as NSDate
        _ = try await database.save(record)
    }

    private func fetchCloudDraft(projectSlug: String, chapterId: String) async throws -> ChapterDraftCache? {
        let id = CKRecord.ID(recordName: recordName("draft", projectSlug, chapterId))
        let record = try await database.record(for: id)
        guard
            let content = record["content"] as? String,
            let updatedAt = record["updatedAt"] as? Date
        else { return nil }
        return ChapterDraftCache(
            projectSlug: projectSlug,
            chapterId: chapterId,
            content: content,
            path: record["path"] as? String,
            updatedAt: updatedAt
        )
    }

    private func performQuery(recordType: String, predicate: NSPredicate) async throws -> [CKRecord] {
        let query = CKQuery(recordType: recordType, predicate: predicate)
        return try await withCheckedThrowingContinuation { continuation in
            database.perform(query, inZoneWith: nil) { records, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: records ?? [])
                }
            }
        }
    }
}
