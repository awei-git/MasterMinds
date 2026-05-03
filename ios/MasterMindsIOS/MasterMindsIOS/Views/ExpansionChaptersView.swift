import SwiftUI

struct ExpansionChaptersView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var chapters: [ChapterUnit] = []
    @State private var isLoading = false

    var body: some View {
        List {
            if !chapters.isEmpty {
                Section {
                    ChapterOverview(chapters: chapters)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            if chapters.isEmpty && !isLoading {
                VStack(alignment: .leading, spacing: 8) {
                    Text("还没有章节结构")
                        .font(AppTheme.title(20))
                    Text("先在结构阶段生成 beat sheet，或在 Web 工作台导入章节结构。")
                        .font(AppTheme.prose(15))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.vertical, 12)
            } else {
                Section {
                    ForEach(chapters) { chapter in
                        NavigationLink {
                            ChapterEditorView(project: project, chapter: chapter)
                        } label: {
                            ChapterRow(chapter: chapter)
                        }
                    }
                } header: {
                    SectionHeaderText(text: "Expansion Chapters")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.page)
        .overlay {
            if isLoading {
                ProgressView()
            }
        }
        .refreshable {
            await load()
        }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            chapters = try await appState.chapters(projectSlug: project.slug)
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}

private struct ChapterRow: View {
    let chapter: ChapterUnit

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(chapter.chapter)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(AppTheme.muted)
                .frame(width: 34, alignment: .leading)

            VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(chapter.title)
                    .font(AppTheme.title(17))
                if chapter.key {
                    StatusPill(text: "关键", color: .orange)
                        .accessibilityLabel("关键章节")
                }
                Spacer()
                StatusPill(text: chapter.statusLabel, color: statusColor)
            }

            Text(chapter.summary)
                .font(AppTheme.prose(14))
                .foregroundStyle(AppTheme.muted)
                .lineLimit(3)

            HStack {
                Label("目标 \(chapter.wordBudget)", systemImage: "target")
                if let wordCount = chapter.wordCount {
                    Label("已写 \(wordCount)", systemImage: "doc.text")
                }
            }
            .font(.caption2)
            .foregroundStyle(AppTheme.faint)
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch chapter.status {
        case "done": .green
        case "review", "revising": .orange
        case "writing": AppTheme.accent
        default: AppTheme.muted
        }
    }
}

private struct ChapterOverview: View {
    let chapters: [ChapterUnit]

    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Draft Map")
                        .font(AppTheme.title(18))
                    Spacer()
                    Text("\(chapters.count) chapters")
                        .font(AppTheme.ui(12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }
                HStack(spacing: 12) {
                    MetricTile(label: "目标字数", value: "\(chapters.map(\.wordBudget).reduce(0, +))", icon: "target")
                    MetricTile(label: "已完成", value: "\(chapters.filter { $0.status == "done" }.count)", icon: "checkmark.circle")
                }
                ThinProgress(
                    value: chapters.isEmpty ? 0 : Double(chapters.filter { $0.status != "blank" }.count) / Double(chapters.count),
                    color: AppTheme.phaseTint("expansion")
                )
            }
        }
    }
}

private struct ChapterEditorView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project
    let chapter: ChapterUnit

    @State private var draft = ""
    @State private var instruction = ""
    @State private var savedPath: String?
    @State private var isLoading = false
    @State private var isRunning = false
    @State private var isSaving = false
    @State private var focusMode = false

    var body: some View {
        ScrollView {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 18) {
                    editorColumn
                    if !focusMode {
                        inspector
                            .frame(width: 280)
                    }
                }

                VStack(alignment: .leading, spacing: 16) {
                    if !focusMode {
                        inspector
                    }
                    editorColumn
                }
            }
            .padding(20)
        }
        .navigationTitle(chapter.title)
        .navigationBarTitleDisplayMode(.inline)
        .background(AppTheme.page)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    focusMode.toggle()
                } label: {
                    Label(focusMode ? "显示上下文" : "专注", systemImage: focusMode ? "sidebar.right" : "rectangle.inset.filled")
                }
                Button {
                    Task { await save() }
                } label: {
                    Label("保存", systemImage: "square.and.arrow.down")
                }
                .disabled(isLoading || isRunning || isSaving)
            }
        }
        .overlay {
            if isLoading {
                ProgressView()
            }
        }
        .task {
            await loadDraft()
        }
    }

    private var editorColumn: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(chapter.title)
                        .font(AppTheme.title(24))
                    Text("\(wordCount) 词 · \(draft.count) 字符 · 约 \(readingMinutes) 分钟")
                        .font(AppTheme.ui(12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                if isSaving {
                    ProgressView()
                } else {
                    StatusPill(text: savedPath == nil ? "本地草稿" : "已保存", color: AppTheme.brass)
                }
            }

            HStack(spacing: 10) {
                TextField("补充指令", text: $instruction, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(2...4)
                Button {
                    Task { await run(kind: "chapter_briefing") }
                } label: {
                    Label("Brief", systemImage: "doc.text")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await run(kind: draft.isEmpty ? "chapter_draft" : "chapter_revision") }
                } label: {
                    Label(draft.isEmpty ? "生成" : "修订", systemImage: "square.and.pencil")
                }
                .buttonStyle(.borderedProminent)
            }
            .disabled(isLoading || isRunning || isSaving)

            TextEditor(text: $draft)
                .font(AppTheme.prose(19))
                .foregroundStyle(AppTheme.ink)
                .lineSpacing(7)
                .frame(minHeight: focusMode ? 720 : 560)
                .padding(22)
                .scrollContentBackground(.hidden)
                .background(AppTheme.paper)
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(AppTheme.line)
                }
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            if let savedPath {
                Text(savedPath)
                    .font(.caption.monospaced())
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: AppTheme.editorMeasure)
    }

    private var inspector: some View {
        VStack(alignment: .leading, spacing: 12) {
            SurfacePanel {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeaderText(text: "Chapter Brief")
                    Text(chapter.summary)
                        .font(AppTheme.prose(15))
                        .foregroundStyle(AppTheme.muted)
                    Divider()
                    MetricTile(label: "章节", value: chapter.chapter, icon: "number")
                    MetricTile(label: "目标", value: "\(chapter.wordBudget)", icon: "target")
                    MetricTile(label: "状态", value: chapter.statusLabel, icon: "circle.dotted")
                    if chapter.key {
                        StatusPill(text: "关键章节", color: .orange)
                    }
                }
            }
        }
    }

    private var wordCount: Int {
        draft
            .split { $0.isWhitespace || $0.isNewline }
            .count
    }

    private var readingMinutes: Int {
        max(1, Int(ceil(Double(max(wordCount, 1)) / 250.0)))
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await appState.saveChapterDraft(
                projectSlug: project.slug,
                chapterId: chapter.id,
                content: draft
            )
            savedPath = result.path
        } catch {
            appState.lastError = error.localizedDescription
        }
    }

    private func loadDraft() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let artifact = try await appState.chapterDraft(projectSlug: project.slug, chapterId: chapter.id)
            draft = artifact.content ?? ""
            savedPath = artifact.path
        } catch {
            appState.lastError = error.localizedDescription
        }
    }

    private func run(kind: String) async {
        isRunning = true
        defer { isRunning = false }
        do {
            let result = try await appState.runWritingTask(
                projectSlug: project.slug,
                kind: kind,
                chapterId: chapter.id,
                instruction: instruction.isEmpty ? nil : instruction
            )
            if kind != "chapter_briefing" {
                draft = result.content
            }
            savedPath = result.path
        } catch {
            appState.lastError = error.localizedDescription
        }
    }

}
