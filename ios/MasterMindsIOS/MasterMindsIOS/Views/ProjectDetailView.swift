import SwiftUI

struct ProjectDetailView: View {
    @EnvironmentObject private var appState: AppState
    @State private var project: Project
    @State private var workflow: WorkflowResponse?
    @State private var selectedTab = "roundtable"
    @State private var isChangingPhase = false

    init(project: Project) {
        _project = State(initialValue: project)
    }

    var body: some View {
        VStack(spacing: 0) {
            ProjectHeader(project: project)

            Picker("视图", selection: $selectedTab) {
                Text("圆桌").tag("roundtable")
                Text("任务").tag("tasks")
                Text("章节").tag("chapters")
                Text("阶段").tag("phases")
            }
            .pickerStyle(.segmented)
            .padding([.horizontal, .top])

            TabContent(
                selectedTab: selectedTab,
                project: project,
                workflow: workflow,
                onPhaseChange: changePhase
            )
        }
        .navigationTitle(project.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadWorkflow()
        }
    }

    private func loadWorkflow() async {
        do {
            workflow = try await appState.api.workflow()
        } catch {
            appState.lastError = error.localizedDescription
        }
    }

    private func changePhase(_ phase: String) {
        guard phase != project.phase else { return }
        Task {
            isChangingPhase = true
            defer { isChangingPhase = false }
            do {
                project = try await appState.api.setPhase(slug: project.slug, phase: phase)
            } catch {
                appState.lastError = error.localizedDescription
            }
        }
    }
}

private struct ProjectHeader: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title)
                        .font(.title2.weight(.semibold))
                    Text(project.type == "screenplay" ? "剧本" : "小说")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(project.phaseLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.tint.opacity(0.12), in: Capsule())
            }
        }
        .padding()
        .background(.thinMaterial)
    }
}

private struct TabContent: View {
    let selectedTab: String
    let project: Project
    let workflow: WorkflowResponse?
    let onPhaseChange: (String) -> Void

    var body: some View {
        switch selectedTab {
        case "tasks":
            WritingTasksView(project: project)
        case "chapters":
            ExpansionChaptersView(project: project)
        case "phases":
            PhaseFlowView(project: project, workflow: workflow, onPhaseChange: onPhaseChange)
        default:
            RoundtableView(project: project)
        }
    }
}
