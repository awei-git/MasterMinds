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
            Form {
                Section("议题") {
                    TextField("输入本轮圆桌要讨论的问题", text: $topic, axis: .vertical)
                        .lineLimit(2...5)
                    Stepper("最多 \(maxRounds) 轮", value: $maxRounds, in: 1...3)
                    Button {
                        Task { await startRoundtable() }
                    } label: {
                        if isRunning {
                            Label("圆桌进行中", systemImage: "hourglass")
                        } else {
                            Label("开始圆桌", systemImage: "person.3.sequence")
                        }
                    }
                    .disabled(topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
                }
            }
            .frame(maxHeight: 210)

            Divider()

            ScrollViewReader { proxy in
                List(events) { event in
                    RoundtableEventRow(event: event)
                        .id(event.id)
                }
                .overlay {
                    if events.isEmpty {
                        ContentUnavailableView(
                            "还没有圆桌记录",
                            systemImage: "person.3",
                            description: Text("输入议题后开始，史官会在最后归纳纪要。")
                        )
                    }
                }
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
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color)
                Spacer()
                if let round = event.round {
                    Text("第 \(round) 轮")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
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
        .padding(.vertical, 6)
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
