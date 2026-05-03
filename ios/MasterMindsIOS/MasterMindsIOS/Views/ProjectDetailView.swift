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

            ModeBar(selectedTab: $selectedTab)

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
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.title)
                        .font(AppTheme.title(24))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    Text("Manuscript workspace")
                        .font(AppTheme.ui(12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                StatusPill(text: project.phaseLabel, color: AppTheme.phaseTint(project.phase))
            }

            HStack(spacing: 12) {
                MetricTile(label: "类型", value: project.type == "screenplay" ? "剧本" : "小说", icon: "book.pages")
                MetricTile(label: "状态", value: project.status, icon: "circle.dotted")
                MetricTile(label: "更新", value: project.updatedAt.formatted(date: .abbreviated, time: .omitted), icon: "clock")
            }

            WorkflowRail(currentPhase: project.phase)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(AppTheme.surface)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.line)
                .frame(height: 1)
        }
    }
}

private struct WorkflowRail: View {
    let currentPhase: String

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Workflow.phases, id: \.self) { phase in
                VStack(alignment: .leading, spacing: 6) {
                    Text(Workflow.phaseLabel(phase))
                        .font(AppTheme.ui(11, weight: .semibold))
                        .foregroundStyle(phase == normalized(currentPhase) ? AppTheme.ink : AppTheme.muted)
                        .lineLimit(1)
                    ThinProgress(
                        value: phase == normalized(currentPhase) ? 1 : completed(phase) ? 1 : 0,
                        color: completed(phase) || phase == normalized(currentPhase) ? AppTheme.phaseTint(phase) : AppTheme.line
                    )
                }
            }
        }
    }

    private func normalized(_ phase: String) -> String {
        ["draft", "review", "revision", "final"].contains(phase) ? "expansion" : phase
    }

    private func completed(_ phase: String) -> Bool {
        let current = normalized(currentPhase)
        guard
            let phaseIndex = Workflow.phases.firstIndex(of: phase),
            let currentIndex = Workflow.phases.firstIndex(of: current)
        else { return false }
        return phaseIndex < currentIndex
    }
}

private struct ModeBar: View {
    @Binding var selectedTab: String

    private let modes = [
        ("roundtable", "圆桌", "person.3"),
        ("tasks", "文档", "doc.text"),
        ("chapters", "章节", "text.book.closed"),
        ("phases", "流程", "point.3.connected.trianglepath.dotted"),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(modes, id: \.0) { mode in
                    Button {
                        selectedTab = mode.0
                    } label: {
                        Label(mode.1, systemImage: mode.2)
                            .font(AppTheme.ui(15, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(selectedTab == mode.0 ? AppTheme.accent : Color.clear)
                            .foregroundStyle(selectedTab == mode.0 ? AppTheme.reverseInk : AppTheme.ink)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(AppTheme.paper)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.line)
                .frame(height: 1)
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
