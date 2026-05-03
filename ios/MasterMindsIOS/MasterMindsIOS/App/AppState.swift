import Foundation

enum ServerConnectionState: Equatable {
    case unknown
    case checking
    case online
    case offline(String)
}

enum CloudSyncState: Equatable {
    case unknown
    case checking
    case available
    case syncing
    case unavailable(String)
}

@MainActor
final class AppState: ObservableObject {
    @Published var serverBaseURL: String {
        didSet {
            UserDefaults.standard.set(serverBaseURL, forKey: Self.serverKey)
            api = MasterMindsAPI(baseURLString: serverBaseURL)
            connectionState = .unknown
        }
    }

    @Published var api: MasterMindsAPI
    @Published var lastError: String?
    @Published var connectionState: ServerConnectionState = .unknown
    @Published var cloudSyncState: CloudSyncState = .unknown

    private static let serverKey = "serverBaseURL"
    static let defaultServerBaseURL = "http://192.168.1.232:3000"
    private let cloudStore = CloudWritingStore()

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let baseURL: String
        if let saved, !saved.isEmpty, !Self.isDeviceLocalhost(saved) {
            baseURL = saved
        } else {
            baseURL = Self.defaultServerBaseURL
            UserDefaults.standard.set(baseURL, forKey: Self.serverKey)
        }
        serverBaseURL = baseURL
        api = MasterMindsAPI(baseURLString: baseURL)
    }

    private static func isDeviceLocalhost(_ url: String) -> Bool {
        url == "http://localhost:3000"
            || url == "https://localhost:3000"
            || url == "http://127.0.0.1:3000"
            || url == "https://127.0.0.1:3000"
    }

    func checkConnection() async {
        connectionState = .checking
        do {
            _ = try await api.projects()
            connectionState = .online
        } catch {
            connectionState = .offline(error.localizedDescription)
        }
    }

    func checkCloudSync() async {
        cloudSyncState = .checking
        if let message = await cloudStore.accountStatusDescription() {
            cloudSyncState = .unavailable(message)
        } else {
            cloudSyncState = .available
        }
    }

    func projects() async throws -> [Project] {
        do {
            let projects = try await api.projects()
            connectionState = .online
            cloudSyncState = .syncing
            updateCloudState(didSync: await cloudStore.upsertProjects(projects, syncToCloud: true))
            return projects
        } catch {
            connectionState = .offline(error.localizedDescription)
            let cached = await cloudStore.projects()
            await checkCloudSync()
            if !cached.isEmpty {
                return cached
            }
            throw error
        }
    }

    func createProject(title: String, type: String) async throws -> Project {
        do {
            let project = try await api.createProject(title: title, type: type)
            connectionState = .online
            cloudSyncState = .syncing
            updateCloudState(didSync: await cloudStore.upsertProjects([project], syncToCloud: true))
            return project
        } catch {
            connectionState = .offline(error.localizedDescription)
            let project = await cloudStore.createProject(title: title, type: type)
            await checkCloudSync()
            return project
        }
    }

    func setPhase(slug: String, phase: String) async throws -> Project {
        do {
            let project = try await api.setPhase(slug: slug, phase: phase)
            connectionState = .online
            cloudSyncState = .syncing
            updateCloudState(didSync: await cloudStore.upsertProjects([project], syncToCloud: true))
            return project
        } catch {
            connectionState = .offline(error.localizedDescription)
            let project = try await cloudStore.setPhase(slug: slug, phase: phase)
            await checkCloudSync()
            return project
        }
    }

    func workflow() async -> WorkflowResponse {
        (try? await api.workflow()) ?? Workflow.defaultResponse
    }

    func phaseSummary(projectSlug: String, phase: String) async throws -> String? {
        do {
            connectionState = .online
            return try await api.phaseSummary(projectSlug: projectSlug, phase: phase)
        } catch {
            connectionState = .offline(error.localizedDescription)
            return nil
        }
    }

    func chapters(projectSlug: String) async throws -> [ChapterUnit] {
        do {
            let chapters = try await api.chapters(projectSlug: projectSlug)
            connectionState = .online
            cloudSyncState = .syncing
            updateCloudState(didSync: await cloudStore.upsertChapters(chapters, projectSlug: projectSlug, syncToCloud: true))
            return chapters
        } catch {
            connectionState = .offline(error.localizedDescription)
            let cached = await cloudStore.chapters(projectSlug: projectSlug)
            await checkCloudSync()
            return cached
        }
    }

    func chapterDraft(projectSlug: String, chapterId: String) async throws -> SavedArtifactResponse {
        do {
            let artifact = try await api.chapterDraft(projectSlug: projectSlug, chapterId: chapterId)
            connectionState = .online
            if let content = artifact.content {
                _ = await cloudStore.saveChapterDraft(
                    projectSlug: projectSlug,
                    chapterId: chapterId,
                    content: content,
                    path: artifact.path
                )
            }
            return artifact
        } catch {
            connectionState = .offline(error.localizedDescription)
            if let draft = await cloudStore.chapterDraft(projectSlug: projectSlug, chapterId: chapterId) {
                await checkCloudSync()
                return SavedArtifactResponse(content: draft.content, path: draft.path)
            }
            throw error
        }
    }

    func saveChapterDraft(projectSlug: String, chapterId: String, content: String) async throws -> SaveArtifactResponse {
        do {
            let result = try await api.saveChapterDraft(projectSlug: projectSlug, chapterId: chapterId, content: content)
            connectionState = .online
            _ = await cloudStore.saveChapterDraft(projectSlug: projectSlug, chapterId: chapterId, content: content, path: result.path)
            return result
        } catch {
            connectionState = .offline(error.localizedDescription)
            let draft = await cloudStore.saveChapterDraft(projectSlug: projectSlug, chapterId: chapterId, content: content)
            await checkCloudSync()
            return SaveArtifactResponse(ok: true, path: draft.path)
        }
    }

    func runWritingTask(
        projectSlug: String,
        kind: String,
        chapterId: String? = nil,
        instruction: String? = nil
    ) async throws -> WritingTaskResult {
        do {
            let result = try await api.runWritingTask(
                projectSlug: projectSlug,
                kind: kind,
                chapterId: chapterId,
                instruction: instruction
            )
            connectionState = .online
            if let chapterId, kind != "chapter_briefing" {
                _ = await cloudStore.saveChapterDraft(
                    projectSlug: projectSlug,
                    chapterId: chapterId,
                    content: result.content,
                    path: result.path
                )
            }
            return result
        } catch {
            connectionState = .offline(error.localizedDescription)
            throw APIClientError.server("AI 生成需要连接服务器；离线时可以继续编辑并用 iCloud 保存草稿。")
        }
    }

    private func updateCloudState(didSync: Bool) {
        cloudSyncState = didSync
            ? .available
            : .unavailable("CloudKit container 未绑定；已保存到本地缓存")
    }
}
