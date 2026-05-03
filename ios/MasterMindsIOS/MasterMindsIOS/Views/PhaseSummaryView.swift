import SwiftUI

struct PhaseSummaryView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState
    let projectSlug: String
    let phase: String
    @State private var content: String?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("加载纪要")
                } else if let content, !content.isEmpty {
                    ScrollView {
                        Text(content)
                            .font(AppTheme.prose(17))
                            .lineSpacing(6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(22)
                    }
                } else {
                    ContentUnavailableView("没有纪要", systemImage: "doc.text", description: Text("这个阶段还没有保存纪要。"))
                }
            }
            .background(AppTheme.page)
            .navigationTitle(Workflow.phaseLabel(phase))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            content = try await appState.phaseSummary(projectSlug: projectSlug, phase: phase)
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}
