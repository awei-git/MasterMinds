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
                EmptyWorkspaceView()
            }
        }
        .tint(AppTheme.accent)
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

private struct EmptyWorkspaceView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("协同写作室")
                .font(.largeTitle.weight(.semibold))
            Text("选择一个项目，进入构思、世界与角色、结构、全文速写和逐章扩写流程。")
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 440, alignment: .leading)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                Label("圆桌讨论负责决策", systemImage: "person.3")
                Label("独立任务负责产出文档", systemImage: "doc.text")
                Label("章节视图负责扩写和修订", systemImage: "text.book.closed")
            }
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(32)
        .background(AppTheme.page)
    }
}
