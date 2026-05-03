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
                if isLoading && projects.isEmpty {
                    ProgressView("加载项目")
                } else if projects.isEmpty {
                    ContentUnavailableView("没有项目", systemImage: "tray", description: Text("创建一个长篇项目开始。"))
                } else {
                    ForEach(projects) { project in
                        ProjectRow(project: project)
                            .tag(project)
                    }
                }
            }
        }
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
            if selectedProject == nil {
                selectedProject = projects.first
            }
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}

private struct ProjectRow: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(project.title)
                .font(.headline)
                .lineLimit(1)
            HStack {
                Text(project.type == "screenplay" ? "剧本" : "小说")
                Text(project.phaseLabel)
                Text(project.status)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
