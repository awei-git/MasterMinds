import SwiftUI

struct ProjectListView: View {
    @EnvironmentObject private var appState: AppState
    @Binding var selectedProject: Project?
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var showingCreate = false
    @State private var showingSettings = false

    var body: some View {
        List(selection: $selectedProject) {
            Section {
                ServerStatusRow(
                    state: appState.connectionState,
                    serverURL: appState.serverBaseURL,
                    onRetry: {
                        Task {
                            await appState.checkConnection()
                            if case .online = appState.connectionState {
                                await loadProjects()
                            }
                        }
                    }
                )
                .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14))
            }

            Section {
                if isLoading && projects.isEmpty {
                    HStack {
                        ProgressView()
                        Text("加载项目")
                            .foregroundStyle(.secondary)
                    }
                } else if projects.isEmpty {
                    EmptyProjectList()
                } else {
                    ForEach(projects) { project in
                        ProjectRow(project: project)
                            .tag(project)
                    }
                }
            } header: {
                SectionHeaderText(text: "Projects")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.page)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    showingSettings = true
                } label: {
                    Label("服务器", systemImage: "server.rack")
                }
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
            projects = try await appState.api.projects()
            appState.connectionState = .online
            if selectedProject == nil {
                selectedProject = projects.first
            }
        } catch {
            appState.connectionState = .offline(error.localizedDescription)
            appState.lastError = "无法连接到 \(appState.serverBaseURL)。请确认 Mac 上已启动 `pnpm dev:lan`，且手机和 Mac 在同一网络。"
        }
    }
}

private struct ProjectRow: View {
    let project: Project

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(AppTheme.phaseTint(project.phase))
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 7) {
                Text(project.title)
                    .font(.headline.weight(.semibold))
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(project.type == "screenplay" ? "剧本" : "小说")
                    Text("·")
                    Text(project.status)
                    Text("·")
                    Text(project.updatedAt, style: .date)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(text: project.phaseLabel, color: AppTheme.phaseTint(project.phase))
        }
        .padding(.vertical, 8)
    }
}

private struct ServerStatusRow: View {
    let state: ServerConnectionState
    let serverURL: String
    let onRetry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    if state == .checking {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                Text(serverURL)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if case .offline(let message) = state {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Button("重新连接", action: onRetry)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .padding(.top, 4)
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
}

private struct EmptyProjectList: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("没有项目")
                .font(.headline)
            Text("创建一个长篇项目开始协同写作。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
    }
}
