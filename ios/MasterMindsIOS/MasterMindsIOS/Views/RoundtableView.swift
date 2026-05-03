import SwiftUI

struct RoundtableView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var topic = ""
    @State private var events: [RoundtableEvent] = []
    @State private var isRunning = false
    @State private var maxRounds = 2
    @State private var statusMessage = "等待议题"
    @State private var runError: String?
    @State private var currentRunId = UUID().uuidString
    @State private var isLogExpanded = false

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                VStack(spacing: 0) {
                    sessionPanel
                        .frame(maxHeight: isRunning || !events.isEmpty ? 230 : 340)
                    Divider()
                    discussionArea
                }
            } else {
                HStack(alignment: .top, spacing: 0) {
                    sessionPanel
                        .frame(width: 320)
                    Divider()
                    discussionArea
                }
            }
        }
        .background(AppTheme.page)
        .toolbar {
#if canImport(UIKit)
            KeyboardDoneToolbar()
#endif
        }
    }

    private var sessionPanel: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 5) {
                        SectionHeaderText(text: "Roundtable Session")
                        Text("把本轮争议写清楚，再让不同职能轮流拆解。")
                            .font(AppTheme.prose(15))
                            .foregroundStyle(AppTheme.muted)
                    }

                    TextField("本轮要解决的创作问题", text: $topic, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(AppTheme.prose(17))
                        .foregroundStyle(AppTheme.ink)
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
                                    .font(AppTheme.title(16))
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
                        HStack(spacing: 8) {
                            if isRunning {
                                ProgressView()
                                    .tint(AppTheme.reverseInk)
                            }
                            Label(isRunning ? "圆桌进行中" : "开始圆桌", systemImage: "person.3.sequence")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
                    .id("run-button")

                    RoundtableRunStatus(
                        status: statusMessage,
                        error: runError,
                        eventCount: events.count,
                        isRunning: isRunning
                    )
                }
                .padding(18)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(AppTheme.surface)
            .onChange(of: isRunning) {
                if isRunning {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("run-button", anchor: .center)
                    }
                }
            }
        }
    }

    private var discussionArea: some View {
        VStack(spacing: 0) {
            discussionFeed
            meetingLogDrawer
        }
    }

    private var discussionFeed: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("圆桌讨论")
                        .font(AppTheme.title(18))
                    Text(discussionEvents.isEmpty ? statusMessage : "\(discussionEvents.count) 条发言 · \(statusMessage)")
                        .font(AppTheme.ui(12, weight: .medium))
                        .foregroundStyle(runError == nil ? AppTheme.muted : .red)
                        .lineLimit(1)
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
                        if discussionEvents.isEmpty {
                            EmptyDiscussionView(hasEvents: !events.isEmpty, status: statusMessage)
                        } else {
                            ForEach(discussionEvents) { event in
                                RoundtableEventRow(event: event)
                                    .id(event.id)
                            }
                        }
                    }
                    .padding(20)
                }
                .background(AppTheme.page)
                .onChange(of: discussionEvents.count) {
                    if let last = discussionEvents.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var meetingLogDrawer: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isLogExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: isLogExpanded ? "chevron.down" : "chevron.up")
                        .font(AppTheme.ui(12, weight: .semibold))
                        .frame(width: 18)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("会议记录")
                            .font(AppTheme.ui(13, weight: .semibold))
                        Text(events.isEmpty ? "技术事件会收在这里" : "\(events.count) 条事件 · \(statusMessage)")
                            .font(AppTheme.ui(11, weight: .medium))
                            .foregroundStyle(runError == nil ? AppTheme.muted : .red)
                            .lineLimit(1)
                    }
                    Spacer()
                    if isRunning {
                        ProgressView()
                            .scaleEffect(0.78)
                    }
                }
                .foregroundStyle(AppTheme.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(AppTheme.paper)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(AppTheme.line)
                    .frame(height: 1)
            }

            if isLogExpanded {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if events.isEmpty {
                                Text("暂无会议记录。")
                                    .font(AppTheme.prose(14))
                                    .foregroundStyle(AppTheme.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                ForEach(events) { event in
                                    RoundtableLogRow(event: event)
                                        .id(event.id)
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                    .frame(maxHeight: horizontalSizeClass == .compact ? 180 : 240)
                    .background(AppTheme.surface)
                    .onChange(of: events.count) {
                        if let last = events.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
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

    private var discussionEvents: [RoundtableEvent] {
        events.filter { event in
            event.message != nil || event.type == "error"
        }
    }

    private func startRoundtable() async {
        guard !isRunning else { return }
        let trimmedTopic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTopic.isEmpty else { return }
#if canImport(UIKit)
        KeyboardDismissal.dismiss()
#endif
        currentRunId = UUID().uuidString
        isRunning = true
        events.removeAll()
        runError = nil
        isLogExpanded = false
        statusMessage = "正在连接 \(appState.serverBaseURL)"
        defer { isRunning = false }

        do {
            let stream = appState.api.roundtable(
                projectSlug: project.slug,
                phase: project.phase,
                topic: trimmedTopic,
                maxRounds: maxRounds
            )
            var receivedAnyEvent = false
            for try await event in stream {
                receivedAnyEvent = true
                events.append(event)
                statusMessage = status(for: event)
                if event.type == "error" {
                    let message = event.error ?? "圆桌失败"
                    runError = message
                    appState.lastError = message
                }
            }
            if !receivedAnyEvent {
                let message = "服务器没有返回圆桌事件。请检查服务端日志或重试。"
                runError = message
                statusMessage = "圆桌失败"
                events.append(errorEvent(message))
            } else if runError == nil {
                statusMessage = "圆桌完成"
            }
        } catch {
            let message = error.localizedDescription
            runError = message
            statusMessage = "圆桌失败"
            events.append(errorEvent(message))
            appState.lastError = message
        }
    }

    private func status(for event: RoundtableEvent) -> String {
        switch event.type {
        case "roundtable_start":
            return "已连接，圆桌开始"
        case "round_start":
            return "第 \(event.round ?? 1) 轮开始"
        case "agent_start":
            return "\(event.label ?? WorkflowRole.alias(event.role ?? "")) 正在发言"
        case "agent_done":
            return "收到 \(event.label ?? WorkflowRole.alias(event.role ?? "")) 发言"
        case "agent_pass":
            return "\(event.label ?? WorkflowRole.alias(event.role ?? "")) 暂无补充"
        case "chronicler_start":
            return "史官正在整理纪要"
        case "chronicler_done":
            return "史官纪要完成"
        case "round_done":
            return "本轮结束"
        case "done":
            return "圆桌完成"
        case "error":
            return "圆桌失败"
        default:
            return event.type
        }
    }

    private func errorEvent(_ message: String) -> RoundtableEvent {
        RoundtableEvent(
            type: "error",
            discussionId: currentRunId,
            phase: project.phase,
            topic: nil,
            roles: nil,
            role: nil,
            label: "错误",
            round: nil,
            error: message,
            message: nil
        )
    }
}

private struct RoundtableRunStatus: View {
    let status: String
    let error: String?
    let eventCount: Int
    let isRunning: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: error == nil ? (isRunning ? "dot.radiowaves.left.and.right" : "info.circle") : "exclamationmark.triangle")
                .font(AppTheme.ui(15, weight: .semibold))
                .foregroundStyle(error == nil ? AppTheme.brass : .red)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                Text(error ?? status)
                    .font(AppTheme.prose(14))
                    .foregroundStyle(error == nil ? AppTheme.ink : .red)
                    .lineLimit(3)
                Text(eventCount == 0 ? "点击后会先连接服务器，再逐条显示角色发言。" : "已收到 \(eventCount) 条圆桌事件。")
                    .font(AppTheme.ui(11, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(error == nil ? AppTheme.line : Color.red.opacity(0.45))
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
                        .font(AppTheme.title(16))
                        .foregroundStyle(tint)
                    Spacer()
                    if let round = event.round {
                        StatusPill(text: "第 \(round) 轮", color: AppTheme.muted)
                    }
                }

                if let message = event.message {
                    Text(message.content)
                        .font(AppTheme.prose(17))
                        .lineSpacing(6)
                        .textSelection(.enabled)
                } else if let topic = event.topic {
                    Text(topic)
                        .font(AppTheme.prose(15))
                        .foregroundStyle(AppTheme.muted)
                } else if let error = event.error {
                    Text(error)
                        .foregroundStyle(.red)
                } else {
                    Text(event.type)
                        .font(AppTheme.ui(12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
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
        case "agent_done": AppTheme.ink
        default: AppTheme.muted
        }
    }
}

private struct RoundtableLogRow: View {
    let event: RoundtableEvent

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
                .padding(.top, 7)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(AppTheme.ui(12, weight: .semibold))
                        .foregroundStyle(tint)
                    if let round = event.round {
                        Text("第 \(round) 轮")
                            .font(AppTheme.ui(10, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                    Spacer(minLength: 0)
                }
                Text(detail)
                    .font(AppTheme.prose(13))
                    .foregroundStyle(event.type == "error" ? .red : AppTheme.muted)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(AppTheme.line.opacity(0.8))
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
        case "agent_start": return "准备发言"
        case "agent_done": return "发言完成"
        case "agent_pass": return "跳过"
        case "round_done": return "本轮结束"
        case "chronicler_start": return "史官整理"
        case "chronicler_done": return "纪要完成"
        case "done": return "完成"
        case "error": return "错误"
        default: return event.type
        }
    }

    private var detail: String {
        if let message = event.message {
            return message.content
        }
        if let topic = event.topic {
            return topic
        }
        if let error = event.error {
            return error
        }
        if let role = event.role {
            return WorkflowRole.alias(role)
        }
        return event.type
    }

    private var tint: Color {
        if let role = event.message?.role ?? event.role {
            return AppTheme.roleTint(role)
        }
        return switch event.type {
        case "error": .red
        case "chronicler_done": .orange
        case "agent_done": AppTheme.ink
        default: AppTheme.muted
        }
    }
}

private struct RoleSeatRow: View {
    let role: String
    let brief: String

    var body: some View {
        HStack(spacing: 10) {
            Text(WorkflowRole.alias(role).prefix(1))
                .font(AppTheme.title(12))
                .foregroundStyle(AppTheme.reverseInk)
                .frame(width: 24, height: 24)
                .background(AppTheme.roleTint(role), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(WorkflowRole.alias(role))
                    .font(AppTheme.title(13))
                Text(brief)
                    .font(AppTheme.ui(11, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
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

private struct EmptyDiscussionView: View {
    let hasEvents: Bool
    let status: String

    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "quote.bubble")
                    .font(AppTheme.ui(22, weight: .semibold))
                    .foregroundStyle(AppTheme.brass)
                Text(hasEvents ? "等待角色发言" : "尚无本轮讨论")
                    .font(AppTheme.title(18))
                Text(hasEvents ? status : "输入明确议题后启动圆桌。中间区域只显示实质发言，会议记录默认收起。")
                    .font(AppTheme.prose(15))
                    .foregroundStyle(AppTheme.muted)
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
