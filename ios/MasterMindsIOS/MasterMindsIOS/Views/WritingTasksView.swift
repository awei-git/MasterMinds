import SwiftUI

struct WritingTasksView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var isRunningTask: String?
    @State private var result: WritingTaskResult?
    @State private var showingResult = false

    var body: some View {
        List {
            Section("当前阶段") {
                HStack {
                    StatusPill(text: project.phaseLabel, color: AppTheme.phaseTint(project.phase))
                    Spacer()
                }
                Text(taskHint)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            let tasks = Workflow.writingTasks(for: normalized(project.phase))
            if tasks.isEmpty {
                Section {
                    ContentUnavailableView(
                        "这个阶段没有独立任务",
                        systemImage: "doc.badge.plus",
                        description: Text("构思阶段以圆桌决策为主；逐章扩写请切到章节视图。")
                    )
                }
            } else {
                Section("独立写作任务") {
                    ForEach(tasks) { task in
                        Button {
                            Task { await run(task) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "doc.text")
                                    .foregroundStyle(AppTheme.accent)
                                    .frame(width: 24)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(task.title)
                                        .font(.headline.weight(.semibold))
                                    Text(task.subtitle)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if isRunningTask == task.kind {
                                    ProgressView()
                                } else {
                                    Image(systemName: "chevron.right")
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        .disabled(isRunningTask != nil)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
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
            result = try await appState.api.runWritingTask(projectSlug: project.slug, kind: task.kind)
            showingResult = true
        } catch {
            appState.lastError = error.localizedDescription
        }
    }

    private func normalized(_ phase: String) -> String {
        ["draft", "review", "revision", "final"].contains(phase) ? "expansion" : phase
    }
}
