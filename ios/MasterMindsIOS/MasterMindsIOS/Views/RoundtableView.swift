import SwiftUI

struct RoundtableView: View {
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var topic = ""
    @State private var events: [RoundtableEvent] = []
    @State private var isRunning = false
    @State private var maxRounds = 2

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeaderText(text: "Roundtable Brief")
                TextField("本轮要解决的创作问题", text: $topic, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(3...6)
                    .padding(12)
                    .background(AppTheme.page, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(AppTheme.line)
                    }

                HStack {
                    Stepper("最多 \(maxRounds) 轮", value: $maxRounds, in: 1...3)
                        .font(.subheadline)
                    Spacer()
                    Button {
                        Task { await startRoundtable() }
                    } label: {
                        Label(isRunning ? "进行中" : "开始圆桌", systemImage: "person.3")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
                }
            }
            .padding()
            .background(AppTheme.surface)

            Divider()

            ScrollViewReader { proxy in
                List(events) { event in
                    RoundtableEventRow(event: event)
                        .id(event.id)
                }
                .overlay {
                    if events.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("尚无本轮记录")
                                .font(.headline)
                            Text("输入明确议题后启动圆桌。每位角色独立发言，最后由史官归纳纪要。")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(24)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(AppTheme.page)
                .onChange(of: events.count) {
                    if let last = events.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
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
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(color)
                Spacer()
                if let round = event.round {
                    StatusPill(text: "第 \(round) 轮", color: Color(.secondaryLabel))
                }
            }

            if let message = event.message {
                Text(message.content)
                    .font(.body)
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
        .padding(.vertical, 10)
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

    private var color: Color {
        switch event.type {
        case "error": .red
        case "chronicler_done": .orange
        case "agent_done": .primary
        default: .secondary
        }
    }
}

enum WorkflowRole {
    static func alias(_ role: String) -> String {
        switch role {
        case "idea": "灵犀"
        case "architect": "鲁班"
        case "character": "画皮"
        case "writer": "妙笔"
        case "editor": "铁面"
        case "reader": "知音"
        case "continuity": "掌故"
        case "chronicler": "史官"
        case "human": "你"
        default: role
        }
    }
}
