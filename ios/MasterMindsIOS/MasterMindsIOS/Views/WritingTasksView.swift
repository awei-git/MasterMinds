import SwiftUI

struct WritingTasksView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var isRunningTask: String?
    @State private var result: WritingTaskResult?
    @State private var showingResult = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                StageDossier(project: project, taskHint: taskHint)

                let tasks = Workflow.writingTasks(for: normalized(project.phase))
                if tasks.isEmpty {
                    SurfacePanel {
                        ContentUnavailableView(
                            "这个阶段没有独立任务",
                            systemImage: "doc.badge.plus",
                            description: Text("构思阶段以圆桌决策为主；逐章扩写请切到章节视图。")
                        )
                    }
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeaderText(text: "Document Studio")
                        ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                            WritingTaskCard(
                                task: task,
                                index: index + 1,
                                isRunning: isRunningTask == task.kind,
                                isDisabled: isRunningTask != nil,
                                action: { Task { await run(task) } }
                            )
                        }
                    }
                }

                if let result {
                    ResultSummary(result: result) {
                        showingResult = true
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: AppTheme.editorMeasure, alignment: .leading)
        }
        .background(AppTheme.page)
        .sheet(isPresented: $showingResult) {
            if let result {
                NavigationStack {
                    DocumentView(title: "任务结果", content: "保存路径：\(result.path)\n\n\(result.content)")
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("完成") { showingResult = false }
                            }
                        }
                }
            }
        }
    }

    private var taskHint: String {
        switch normalized(project.phase) {
        case "bible":
            "先起草 Bible，再通过圆桌讨论修改角色与世界规则。"
        case "structure":
            "先生成 beat sheet，再用圆桌检查中段、信息密度和翻页欲。"
        case "scriptment":
            "先生成完整压缩叙事，再做结构审稿。"
        default:
            "当前阶段以圆桌或章节视图为主。"
        }
    }

    private func run(_ task: WritingTaskAction) async {
        isRunningTask = task.kind
        defer { isRunningTask = nil }
        do {
            result = try await appState.runWritingTask(projectSlug: project.slug, kind: task.kind)
            showingResult = true
        } catch {
            appState.lastError = error.localizedDescription
        }
    }

    private func normalized(_ phase: String) -> String {
        ["draft", "review", "revision", "final"].contains(phase) ? "expansion" : phase
    }
}

private struct StageDossier: View {
    let project: Project
    let taskHint: String

    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionHeaderText(text: "Current Stage")
                        Text(project.phaseLabel)
                            .font(.title3.weight(.semibold))
                    }
                    Spacer()
                    StatusPill(text: project.status, color: AppTheme.phaseTint(project.phase))
                }

                Text(taskHint)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 12) {
                    MetricTile(label: "项目", value: project.title, icon: "folder")
                    MetricTile(label: "产物", value: artifactLabel(for: project.phase), icon: "doc.richtext")
                }
            }
        }
    }

    private func artifactLabel(for phase: String) -> String {
        switch phase {
        case "bible": "Project Bible"
        case "structure": "Beat Sheet"
        case "scriptment": "Scriptment"
        case "expansion", "draft", "review", "revision", "final": "Review Plan"
        default: "Decision Memo"
        }
    }
}

private struct WritingTaskCard: View {
    let task: WritingTaskAction
    let index: Int
    let isRunning: Bool
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 14) {
                Text(String(format: "%02d", index))
                    .font(.caption.monospacedDigit().weight(.bold))
                    .foregroundStyle(AppTheme.brass)
                    .frame(width: 34, alignment: .leading)

                VStack(alignment: .leading, spacing: 7) {
                    Text(task.title)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                    Text(task.subtitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        StatusPill(text: "AI 起草", color: AppTheme.brass)
                        StatusPill(text: task.kind, color: .secondary)
                    }
                }

                Spacer(minLength: 10)

                if isRunning {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.up.forward")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(AppTheme.brass)
                }
            }
            .padding(16)
            .background(AppTheme.paper)
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.line)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled && !isRunning ? 0.55 : 1)
    }
}

private struct ResultSummary: View {
    let result: WritingTaskResult
    let open: () -> Void

    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("最近产物", systemImage: "checkmark.seal")
                        .font(.headline.weight(.semibold))
                    Spacer()
                    Button("打开", action: open)
                        .buttonStyle(.bordered)
                }
                Text(result.path)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(result.content)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }
        }
    }
}
