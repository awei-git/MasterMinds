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

struct RoundtableSessionState: Equatable {
    var topic = ""
    var events: [RoundtableEvent] = []
    var isRunning = false
    var maxRounds = 2
    var statusMessage = "等待议题"
    var runError: String?
    var currentRunId = UUID().uuidString

    var discussionEvents: [RoundtableEvent] {
        events.filter { event in
            event.message != nil || event.type == "error"
        }
    }
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
    @Published private(set) var roundtableSessions: [String: RoundtableSessionState] = [:]

    private static let serverKey = "serverBaseURL"
    static let defaultServerBaseURL = "http://192.168.1.232:3000"
    private let cloudStore = CloudWritingStore()
    private var roundtableTasks: [String: Task<Void, Never>] = [:]

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

    func roundtableSession(projectSlug: String, phase: String) -> RoundtableSessionState {
        roundtableSessions[roundtableSessionKey(projectSlug: projectSlug, phase: phase)] ?? RoundtableSessionState()
    }

    func updateRoundtableTopic(projectSlug: String, phase: String, topic: String) {
        let key = roundtableSessionKey(projectSlug: projectSlug, phase: phase)
        var session = roundtableSessions[key] ?? RoundtableSessionState()
        session.topic = topic
        roundtableSessions[key] = session
    }

    func updateRoundtableMaxRounds(projectSlug: String, phase: String, maxRounds: Int) {
        let key = roundtableSessionKey(projectSlug: projectSlug, phase: phase)
        var session = roundtableSessions[key] ?? RoundtableSessionState()
        session.maxRounds = max(1, min(maxRounds, 3))
        roundtableSessions[key] = session
    }

    func startRoundtable(projectSlug: String, phase: String) async {
        let key = roundtableSessionKey(projectSlug: projectSlug, phase: phase)
        var session = roundtableSessions[key] ?? RoundtableSessionState()
        guard !session.isRunning else { return }

        let trimmedTopic = session.topic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTopic.isEmpty else { return }

        session.currentRunId = UUID().uuidString
        session.isRunning = true
        session.events.removeAll()
        session.runError = nil
        session.statusMessage = "正在连接 \(serverBaseURL)"
        roundtableSessions[key] = session

        let task = Task {
            await runRoundtable(projectSlug: projectSlug, phase: phase, key: key, initialSession: session)
        }
        roundtableTasks[key] = task
        await task.value
    }

    func cancelRoundtable(projectSlug: String, phase: String) {
        let key = roundtableSessionKey(projectSlug: projectSlug, phase: phase)
        roundtableTasks[key]?.cancel()
        roundtableTasks[key] = nil

        var session = roundtableSessions[key] ?? RoundtableSessionState()
        guard session.isRunning else { return }
        session.isRunning = false
        session.statusMessage = "已停止"
        session.runError = nil
        roundtableSessions[key] = session
    }

    private func runRoundtable(
        projectSlug: String,
        phase: String,
        key: String,
        initialSession session: RoundtableSessionState
    ) async {
        defer {
            var latest = roundtableSessions[key] ?? session
            latest.isRunning = false
            roundtableSessions[key] = latest
            roundtableTasks[key] = nil
        }

        do {
            let stream = api.roundtable(
                projectSlug: projectSlug,
                phase: phase,
                topic: session.topic.trimmingCharacters(in: .whitespacesAndNewlines),
                maxRounds: session.maxRounds,
                generateSummary: false
            )
            var receivedAnyEvent = false
            for try await event in stream {
                try Task.checkCancellation()
                receivedAnyEvent = true
                var latest = roundtableSessions[key] ?? session
                latest.events.append(event)
                latest.statusMessage = status(for: event)
                if event.type == "error" {
                    let message = event.error ?? "圆桌失败"
                    latest.runError = message
                    lastError = message
                }
                roundtableSessions[key] = latest
            }
            var latest = roundtableSessions[key] ?? session
            if !receivedAnyEvent {
                let message = "服务器没有返回圆桌事件。请检查服务端日志或重试。"
                latest.runError = message
                latest.statusMessage = "圆桌失败"
                latest.events.append(errorEvent(message, discussionId: latest.currentRunId, phase: phase))
            } else if latest.runError == nil {
                latest.statusMessage = "圆桌完成"
            }
            connectionState = .online
            roundtableSessions[key] = latest
        } catch is CancellationError {
            var latest = roundtableSessions[key] ?? session
            latest.runError = nil
            latest.statusMessage = "已停止"
            roundtableSessions[key] = latest
        } catch {
            let message = error.localizedDescription
            var latest = roundtableSessions[key] ?? session
            latest.runError = message
            latest.statusMessage = "圆桌失败"
            latest.events.append(errorEvent(message, discussionId: latest.currentRunId, phase: phase))
            connectionState = .offline(message)
            lastError = message
            roundtableSessions[key] = latest
        }
    }

    private func updateCloudState(didSync: Bool) {
        cloudSyncState = didSync
            ? .available
            : .unavailable(cloudStore.syncIssueDescription())
    }

    private func roundtableSessionKey(projectSlug: String, phase: String) -> String {
        "\(projectSlug)::\(Workflow.normalizePhase(phase))"
    }

    private func status(for event: RoundtableEvent) -> String {
        switch event.type {
        case "roundtable_start":
            return "已连接，圆桌开始"
        case "round_start":
            return "第 \(event.round ?? 1) 轮开始"
        case "agent_start":
            return "\(event.label ?? WorkflowRole.alias(event.role ?? "")) 正在发言"
        case "agent_done":
            return "收到 \(event.label ?? WorkflowRole.alias(event.role ?? "")) 发言"
        case "agent_pass":
            return "\(event.label ?? WorkflowRole.alias(event.role ?? "")) 暂无补充"
        case "chronicler_start":
            return "史官正在整理纪要"
        case "chronicler_done":
            return "史官纪要完成"
        case "round_done":
            return "本轮结束"
        case "done":
            return "圆桌完成"
        case "error":
            return "圆桌失败"
        default:
            return event.type
        }
    }

    private func errorEvent(_ message: String, discussionId: String, phase: String) -> RoundtableEvent {
        RoundtableEvent(
            type: "error",
            discussionId: discussionId,
            phase: phase,
            topic: nil,
            roles: nil,
            role: nil,
            label: "错误",
            round: nil,
            error: message,
            message: nil
        )
    }
}
