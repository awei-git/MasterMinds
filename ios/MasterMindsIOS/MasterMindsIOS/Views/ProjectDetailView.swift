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
                Text("文档").tag("tasks")
                Text("章节").tag("chapters")
                Text("流程").tag("phases")
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(AppTheme.surface)

            TabContent(
                selectedTab: selectedTab,
                project: project,
                workflow: workflow,
                onPhaseChange: changePhase
            )
        }
        .navigationTitle(project.title)
        .navigationBarTitleDisplayMode(.inline)
        .background(AppTheme.page)
        .task {
            await loadWorkflow()
        }
    }

    private func loadWorkflow() async {
        workflow = await appState.workflow()
    }

    private func changePhase(_ phase: String) {
        guard phase != project.phase else { return }
        Task {
            isChangingPhase = true
            defer { isChangingPhase = false }
            do {
                project = try await appState.setPhase(slug: project.slug, phase: phase)
            } catch {
                appState.lastError = error.localizedDescription
            }
        }
    }
}

private struct ProjectHeader: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(project.title)
                    .font(.title2.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                StatusPill(text: project.phaseLabel, color: AppTheme.phaseTint(project.phase))
            }

            HStack(spacing: 18) {
                MetaItem(label: "类型", value: project.type == "screenplay" ? "剧本" : "小说")
                MetaItem(label: "状态", value: project.status)
                MetaItem(label: "更新", value: project.updatedAt.formatted(date: .abbreviated, time: .omitted))
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 16)
        .background(AppTheme.surface)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.line)
                .frame(height: 1)
        }
    }
}

private struct MetaItem: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .foregroundStyle(.primary)
        }
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
