import SwiftUI

struct ProjectListView: View {
    @EnvironmentObject private var appState: AppState
    @Binding var selectedProject: Project?
    let usesNavigationLinks: Bool
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var showingCreate = false
    @State private var showingSettings = false

    init(selectedProject: Binding<Project?>, usesNavigationLinks: Bool = false) {
        _selectedProject = selectedProject
        self.usesNavigationLinks = usesNavigationLinks
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center, spacing: 14) {
                    ShenxianLogoMark(size: 58)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("神仙会")
                            .font(AppTheme.display(42))
                            .foregroundStyle(AppTheme.ink)
                        Text("稿件库 · \(projects.count) 个项目")
                            .font(AppTheme.ui(13, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)

                ServerStatusRow(
                    state: appState.connectionState,
                    cloudState: appState.cloudSyncState,
                    serverURL: appState.serverBaseURL,
                    onRetry: {
                        Task {
                            await appState.checkConnection()
                            await appState.checkCloudSync()
                            await loadProjects()
                        }
                    }
                )
                .padding(.horizontal, 14)

                SectionHeaderText(text: "Manuscripts")
                    .padding(.horizontal, 18)

                if isLoading && projects.isEmpty {
                    HStack {
                        ProgressView()
                        Text("加载项目")
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 18)
                } else if projects.isEmpty {
                    EmptyProjectList()
                        .padding(.horizontal, 18)
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(projects) { project in
                            if usesNavigationLinks {
                                NavigationLink(value: project) {
                                    ProjectRow(
                                        project: project,
                                        isSelected: selectedProject?.slug == project.slug
                                    )
                                }
                                .buttonStyle(.plain)
                                .simultaneousGesture(TapGesture().onEnded {
                                    selectedProject = project
                                })
                            } else {
                                Button {
                                    selectedProject = project
                                } label: {
                                    ProjectRow(
                                        project: project,
                                        isSelected: selectedProject?.slug == project.slug
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 10)
                }
            }
            .padding(.bottom, 20)
        }
        .background(AppTheme.sidebar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    showingSettings = true
                } label: {
                    ShenxianLogoMark(size: 28)
                }
                .accessibilityLabel("服务器")
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await loadProjects() }
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                Button {
                    showingCreate = true
                } label: {
                    Label("新建", systemImage: "plus")
                }
            }
        }
        .task {
            await appState.checkConnection()
            await appState.checkCloudSync()
            await loadProjects()
        }
        .refreshable {
            await loadProjects()
        }
        .sheet(isPresented: $showingCreate) {
            CreateProjectView { project in
                projects.insert(project, at: 0)
                selectedProject = project
            }
            .environmentObject(appState)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environmentObject(appState)
        }
    }

    private func loadProjects() async {
        isLoading = true
        defer { isLoading = false }
        do {
            projects = try await appState.projects()
            if selectedProject == nil {
                selectedProject = projects.first
            }
        } catch {
            appState.connectionState = .offline(error.localizedDescription)
        }
    }
}

private struct ProjectRow: View {
    let project: Project
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline) {
                    Text(project.title)
                        .font(AppTheme.title(18))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    Spacer()
                    Text(project.updatedAt, style: .date)
                        .font(AppTheme.ui(11, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }

                HStack(spacing: 8) {
                    Text(project.type == "screenplay" ? "剧本" : "小说")
                    Text("·")
                    Text(project.status)
                }
                .font(AppTheme.ui(12, weight: .medium))
                .foregroundStyle(AppTheme.muted)
            }

            HStack(spacing: 10) {
                ThinProgress(value: phaseProgress(project.phase), color: AppTheme.phaseTint(project.phase))
                StatusPill(text: project.phaseLabel, color: AppTheme.phaseTint(project.phase))
            }
        }
        .padding(12)
        .background(isSelected ? AppTheme.paper : AppTheme.surface.opacity(0.72))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(isSelected ? AppTheme.brass.opacity(0.55) : AppTheme.line)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func phaseProgress(_ phase: String) -> Double {
        switch phase {
        case "conception": 0.12
        case "bible": 0.32
        case "structure": 0.50
        case "scriptment": 0.68
        case "expansion", "draft", "review", "revision", "final": 0.86
        default: 0.2
        }
    }
}

private struct ServerStatusRow: View {
    let state: ServerConnectionState
    let cloudState: CloudSyncState
    let serverURL: String
    let onRetry: () -> Void

    var body: some View {
        SurfacePanel {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(AppTheme.ui(20, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 22)

                VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title)
                        .font(AppTheme.title(16))
                    Spacer()
                    if state == .checking {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                Text(serverURL)
                    .font(.caption.monospaced())
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                Text(cloudTitle)
                    .font(AppTheme.ui(12, weight: .medium))
                    .foregroundStyle(cloudColor)
                if case .offline(let message) = state {
                    Text(message)
                        .font(AppTheme.prose(14))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                    Button("重新连接", action: onRetry)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .padding(.top, 4)
                }
                }
            }
        }
    }

    private var title: String {
        switch state {
        case .unknown: "服务器未检查"
        case .checking: "正在检查服务器"
        case .online: "服务器在线"
        case .offline: "服务器不可达"
        }
    }

    private var icon: String {
        switch state {
        case .online: "checkmark.seal"
        case .offline: "exclamationmark.triangle"
        case .checking: "server.rack"
        case .unknown: "server.rack"
        }
    }

    private var color: Color {
        switch state {
        case .online: .green
        case .offline: .red
        case .checking: .secondary
        case .unknown: .secondary
        }
    }

    private var cloudTitle: String {
        switch cloudState {
        case .unknown: "iCloud 未检查"
        case .checking: "正在检查 iCloud"
        case .available: "iCloud 同步可用"
        case .syncing: "正在同步到 iCloud"
        case .unavailable(let message): "iCloud 不可用：\(message)"
        }
    }

    private var cloudColor: Color {
        switch cloudState {
        case .available, .syncing: .secondary
        case .unavailable: .orange
        case .unknown, .checking: .secondary
        }
    }
}

private struct EmptyProjectList: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("没有项目")
                .font(AppTheme.title(22))
                .foregroundStyle(AppTheme.ink)
            Text("创建一个长篇项目开始协同写作。")
                .font(AppTheme.prose(15))
                .foregroundStyle(AppTheme.muted)
        }
        .padding(.vertical, 12)
    }
}
