import SwiftUI

struct RoundtableView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var topic = ""
    @State private var events: [RoundtableEvent] = []
    @State private var isRunning = false
    @State private var maxRounds = 2

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 0) {
                sessionPanel
                    .frame(width: 320)
                Divider()
                transcript
            }

            VStack(spacing: 0) {
                sessionPanel
                Divider()
                transcript
            }
        }
        .background(AppTheme.page)
    }

    private var sessionPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    SectionHeaderText(text: "Roundtable Session")
                    Text("把本轮争议写清楚，再让不同职能轮流拆解。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                TextField("本轮要解决的创作问题", text: $topic, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .lineLimit(5...8)
                    .padding(14)
                    .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(AppTheme.line)
                    }

                SurfacePanel {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Label("轮次", systemImage: "repeat")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(maxRounds)")
                                .font(.title3.monospacedDigit().weight(.semibold))
                        }
                        Stepper("最多 \(maxRounds) 轮", value: $maxRounds, in: 1...3)
                            .labelsHidden()
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    SectionHeaderText(text: "Seats")
                    ForEach(seats, id: \.role) { seat in
                        RoleSeatRow(role: seat.role, brief: seat.brief)
                    }
                }

                Button {
                    Task { await startRoundtable() }
                } label: {
                    Label(isRunning ? "圆桌进行中" : "开始圆桌", systemImage: "person.3.sequence")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
            }
            .padding(18)
        }
        .background(AppTheme.surface)
    }

    private var transcript: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("会议记录")
                        .font(.headline.weight(.semibold))
                    Text(events.isEmpty ? "等待开始" : "\(events.count) 条事件")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if isRunning {
                    ProgressView()
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(AppTheme.paper)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(AppTheme.line)
                    .frame(height: 1)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if events.isEmpty {
                            EmptyTranscriptView()
                        } else {
                            ForEach(events) { event in
                                RoundtableEventRow(event: event)
                                    .id(event.id)
                            }
                        }
                    }
                    .padding(20)
                }
                .background(AppTheme.page)
                .onChange(of: events.count) {
                    if let last = events.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var seats: [(role: String, brief: String)] {
        [
            ("architect", "结构和因果"),
            ("character", "人物心理"),
            ("editor", "取舍和风险"),
            ("reader", "读者体验"),
            ("continuity", "设定连续性"),
            ("chronicler", "纪要归纳"),
        ]
    }

    private func startRoundtable() async {
        isRunning = true
        events.removeAll()
        defer { isRunning = false }

        do {
            let stream = appState.api.roundtable(
                projectSlug: project.slug,
                phase: project.phase,
                topic: topic,
                maxRounds: maxRounds
            )
            for try await event in stream {
                events.append(event)
                if event.type == "error" {
                    appState.lastError = event.error ?? "圆桌失败"
                }
            }
        } catch {
            appState.lastError = error.localizedDescription
        }
    }
}

private struct RoundtableEventRow: View {
    let event: RoundtableEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 4) {
                Circle()
                    .fill(tint)
                    .frame(width: 10, height: 10)
                Rectangle()
                    .fill(AppTheme.line)
                    .frame(width: 1)
            }
            .frame(width: 18)

            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(tint)
                    Spacer()
                    if let round = event.round {
                        StatusPill(text: "第 \(round) 轮", color: Color(.secondaryLabel))
                    }
                }

                if let message = event.message {
                    Text(message.content)
                        .font(.body)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                } else if let topic = event.topic {
                    Text(topic)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else if let error = event.error {
                    Text(error)
                        .foregroundStyle(.red)
                } else {
                    Text(event.type)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .background(AppTheme.paper)
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.line)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private var title: String {
        if let message = event.message {
            return WorkflowRole.alias(message.role)
        }
        if let label = event.label {
            return label
        }
        switch event.type {
        case "roundtable_start": return "圆桌开始"
        case "round_start": return "新一轮"
        case "round_done": return "本轮结束"
        case "chronicler_start": return "史官"
        case "done": return "完成"
        case "error": return "错误"
        default: return event.type
        }
    }

    private var tint: Color {
        if let role = event.message?.role ?? event.role {
            return AppTheme.roleTint(role)
        }
        return switch event.type {
        case "error": .red
        case "chronicler_done": .orange
        case "agent_done": .primary
        default: .secondary
        }
    }
}

private struct RoleSeatRow: View {
    let role: String
    let brief: String

    var body: some View {
        HStack(spacing: 10) {
            Text(WorkflowRole.alias(role).prefix(1))
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.paper)
                .frame(width: 24, height: 24)
                .background(AppTheme.roleTint(role), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(WorkflowRole.alias(role))
                    .font(.caption.weight(.semibold))
                Text(brief)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(10)
        .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(AppTheme.line)
        }
    }
}

private struct EmptyTranscriptView: View {
    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "quote.bubble")
                    .font(.title2)
                    .foregroundStyle(AppTheme.brass)
                Text("尚无本轮记录")
                    .font(.headline)
                Text("输入明确议题后启动圆桌。每位角色独立发言，最后由史官归纳纪要。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

enum WorkflowRole {
    static func alias(_ role: String) -> String {
        switch role {
        case "idea": "灵犀"
        case "story_architect", "architect": "鲁班"
        case "plot_doctor": "承梁"
        case "character", "character_psychologist": "画皮"
        case "writer", "bible_writer", "structure_writer", "scriptment_writer", "chapter_writer": "妙笔"
        case "editor", "style_editor", "market_editor", "scriptment_reviewer", "chapter_editor": "铁面"
        case "reader": "知音"
        case "continuity", "continuity_editor": "掌故"
        case "chronicler": "史官"
        case "human": "你"
        default: role
        }
    }
}
