import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState
    @State private var selectedProject: Project?

    var body: some View {
        NavigationSplitView {
            ProjectListView(selectedProject: $selectedProject)
                .navigationTitle("神仙会")
        } detail: {
            if let selectedProject {
                ProjectDetailView(project: selectedProject)
                    .id(selectedProject.slug)
            } else {
                ContentUnavailableView(
                    "选择一个项目",
                    systemImage: "book.pages",
                    description: Text("从左侧项目列表进入创作室。")
                )
            }
        }
        .alert("请求失败", isPresented: Binding(
            get: { appState.lastError != nil },
            set: { if !$0 { appState.lastError = nil } }
        )) {
            Button("好", role: .cancel) { appState.lastError = nil }
        } message: {
            Text(appState.lastError ?? "")
        }
    }
}
