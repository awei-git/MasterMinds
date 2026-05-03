import SwiftUI

struct CreateProjectView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState
    @State private var title = ""
    @State private var type = "novel"
    @State private var isCreating = false

    let onCreated: (Project) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("项目") {
                    TextField("标题", text: $title)
                    Picker("类型", selection: $type) {
                        Text("小说").tag("novel")
                        Text("剧本").tag("screenplay")
                    }
                    .pickerStyle(.segmented)
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppTheme.page)
            .navigationTitle("新建项目")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "创建中" : "创建") {
                        Task { await create() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCreating)
                }
            }
        }
    }

    private func create() async {
        isCreating = true
        defer { isCreating = false }
        do {
            let project = try await appState.createProject(title: title, type: type)
            onCreated(project)
            dismiss()
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}
