import SwiftUI

struct PhaseFlowView: View {
    let project: Project
    let workflow: WorkflowResponse?
    let onPhaseChange: (String) -> Void
    @State private var selectedSummaryPhase: SummaryPhase?

    var body: some View {
        List {
            Section {
                ForEach(workflow?.phases ?? fallbackPhases) { phase in
                    PhaseRow(
                        phase: phase,
                        isCurrent: normalized(project.phase) == phase.key,
                        isPast: phaseIndex(normalized(project.phase)) > phaseIndex(phase.key),
                        onSelect: { onPhaseChange(phase.key) },
                        onSummary: { selectedSummaryPhase = SummaryPhase(key: phase.key) }
                    )
                }
            } header: {
                SectionHeaderText(text: "Workflow")
            }

            if let workflow {
                Section {
                    NavigationLink("圆桌发言规则") {
                        DocumentView(title: "圆桌发言规则", content: workflow.roundtableProtocol)
                    }
                    NavigationLink("Scriptment 结构审稿") {
                        DocumentView(title: "Scriptment 结构审稿", content: workflow.scriptmentReviewProtocol)
                    }
                    NavigationLink("逐章扩写协议") {
                        DocumentView(title: "逐章扩写协议", content: workflow.expansionProtocol)
                    }
                } header: {
                    SectionHeaderText(text: "Protocols")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.page)
        .sheet(item: $selectedSummaryPhase) { phase in
            PhaseSummaryView(projectSlug: project.slug, phase: phase.key)
        }
    }

    private var fallbackPhases: [PhaseDefinition] {
        [
            PhaseDefinition(key: "conception", label: "构思", goal: "锁定 logline、核心冲突、主题。", roundtableRoles: [], writingRole: nil, outputArtifact: "", confirmationGate: ""),
            PhaseDefinition(key: "bible", label: "世界与角色", goal: "锁定角色档案、世界设定、规则。", roundtableRoles: [], writingRole: nil, outputArtifact: "", confirmationGate: ""),
            PhaseDefinition(key: "structure", label: "结构", goal: "锁定 beat sheet、章节大纲、张力曲线。", roundtableRoles: [], writingRole: nil, outputArtifact: "", confirmationGate: ""),
            PhaseDefinition(key: "scriptment", label: "全文速写", goal: "生成完整压缩叙事。", roundtableRoles: [], writingRole: nil, outputArtifact: "", confirmationGate: ""),
            PhaseDefinition(key: "expansion", label: "逐章扩写", goal: "逐章扩写到完整散文。", roundtableRoles: [], writingRole: nil, outputArtifact: "", confirmationGate: ""),
        ]
    }

    private func normalized(_ phase: String) -> String {
        ["draft", "review", "revision", "final"].contains(phase) ? "expansion" : phase
    }

    private func phaseIndex(_ phase: String) -> Int {
        Workflow.phases.firstIndex(of: phase) ?? 0
    }
}

private struct PhaseRow: View {
    let phase: PhaseDefinition
    let isCurrent: Bool
    let isPast: Bool
    let onSelect: () -> Void
    let onSummary: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: isCurrent ? "largecircle.fill.circle" : isPast ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(statusColor)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 3) {
                    Text(phase.label)
                        .font(.headline.weight(.semibold))
                    Text(phase.goal)
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
            }
            HStack {
                Button("切换阶段", action: onSelect)
                    .buttonStyle(.bordered)
                    .disabled(isCurrent)
                Button("查看纪要", action: onSummary)
                    .buttonStyle(.bordered)
            }
            .font(.caption)
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        if isCurrent { return AppTheme.accent }
        if isPast { return .green }
        return AppTheme.muted
    }
}

private struct SummaryPhase: Identifiable {
    let key: String
    var id: String { key }
}
