import SwiftUI

struct ExpansionChaptersView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var chapters: [ChapterUnit] = []
    @State private var isLoading = false

    var body: some View {
        List {
            if chapters.isEmpty && !isLoading {
                VStack(alignment: .leading, spacing: 8) {
                    Text("还没有章节结构")
                        .font(.headline)
                    Text("先在结构阶段生成 beat sheet，或在 Web 工作台导入章节结构。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
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
            chapters = try await appState.api.chapters(projectSlug: project.slug)
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}

private struct ChapterRow: View {
    let chapter: ChapterUnit

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(chapter.title)
                    .font(.headline.weight(.semibold))
                if chapter.key {
                    StatusPill(text: "关键", color: .orange)
                        .accessibilityLabel("关键章节")
                }
                Spacer()
                StatusPill(text: chapter.statusLabel, color: statusColor)
            }

            Text(chapter.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            HStack {
                Label("目标 \(chapter.wordBudget)", systemImage: "target")
                if let wordCount = chapter.wordCount {
                    Label("已写 \(wordCount)", systemImage: "doc.text")
                }
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch chapter.status {
        case "done": .green
        case "review", "revising": .orange
        case "writing": .accentColor
        default: .secondary
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(chapter.title)
                            .font(.title3.weight(.semibold))
                        Spacer()
                        StatusPill(text: chapter.statusLabel, color: AppTheme.phaseTint(project.phase))
                    }

                    Text(chapter.summary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                TextField("补充指令", text: $instruction, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)

                HStack {
                    Button {
                        Task { await run(kind: "chapter_briefing") }
                    } label: {
                        Label("生成 Briefing", systemImage: "doc.text")
                    }
                    .buttonStyle(.bordered)

                    Button {
                        Task { await run(kind: draft.isEmpty ? "chapter_draft" : "chapter_revision") }
                    } label: {
                        Label(draft.isEmpty ? "生成正文" : "修订正文", systemImage: "square.and.pencil")
                    }
                    .buttonStyle(.borderedProminent)

                    Spacer()

                    if isRunning {
                        ProgressView()
                    }
                }
                .disabled(isLoading || isRunning || isSaving)

                TextEditor(text: $draft)
                    .font(.body.monospaced())
                    .frame(minHeight: 420)
                    .padding(8)
                    .scrollContentBackground(.hidden)
                    .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(AppTheme.line)
                    }

                HStack {
                    Text("\(draft.count) 字符")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Label("保存", systemImage: "square.and.arrow.down")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isLoading || isRunning || isSaving)
                }

                if let savedPath {
                    Text("保存路径：\(savedPath)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .navigationTitle(chapter.title)
        .navigationBarTitleDisplayMode(.inline)
        .background(AppTheme.page)
        .overlay {
            if isLoading {
                ProgressView()
            }
        }
        .task {
            await loadDraft()
        }
    }

    private func loadDraft() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let artifact = try await appState.api.chapterDraft(projectSlug: project.slug, chapterId: chapter.id)
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
            let result = try await appState.api.runWritingTask(
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

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await appState.api.saveChapterDraft(
                projectSlug: project.slug,
                chapterId: chapter.id,
                content: draft
            )
            savedPath = result.path
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}
