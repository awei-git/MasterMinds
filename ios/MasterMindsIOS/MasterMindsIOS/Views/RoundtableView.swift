import SwiftUI

struct RoundtableView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var appState: AppState
    let project: Project

    @State private var isRecordExpanded = false
    @State private var isThreadOpen = false

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                compactWorkspace
            } else {
                HStack(alignment: .top, spacing: 0) {
                    sessionPanel
                        .frame(width: 340)
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
        .navigationDestination(isPresented: $isThreadOpen) {
            RoundtableThreadView(
                project: project,
                topic: topicText,
                status: statusMessage,
                error: runError,
                events: discussionEvents,
                isRunning: isRunning,
                onCancel: cancelRoundtable,
                onSendReply: sendRoundtableReply
            )
        }
    }

    private var sessionPanel: some View {
        ScrollViewReader { proxy in
            ScrollView {
                sessionControls
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

    private var compactWorkspace: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SurfacePanel {
                    sessionControls
                }

                DiscussionThreadSummary(
                    status: statusMessage,
                    error: runError,
                    events: discussionEvents,
                    isRunning: isRunning,
                    onOpen: { isThreadOpen = true }
                )

                MeetingRecordPanel(
                    topic: topicText,
                    status: statusMessage,
                    error: runError,
                    events: events,
                    isRunning: isRunning,
                    isExpanded: $isRecordExpanded
                )
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(AppTheme.page)
    }

    private var sessionControls: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                SectionHeaderText(text: "Roundtable Session")
                Text("把本轮争议写清楚，再让不同职能轮流拆解。")
                    .font(AppTheme.prose(15))
                    .foregroundStyle(AppTheme.muted)
            }

            TextField("本轮要解决的创作问题", text: topic, axis: .vertical)
                .textFieldStyle(.plain)
                .font(AppTheme.prose(17))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(4...7)
                .padding(14)
                .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(AppTheme.line)
                }

            HStack(alignment: .center, spacing: 12) {
                Label("轮次", systemImage: "repeat")
                    .font(AppTheme.title(16))
                Spacer()
                Stepper("最多 \(session.maxRounds) 轮", value: maxRounds, in: 1...3)
                    .labelsHidden()
                Text("\(session.maxRounds)")
                    .font(.title3.monospacedDigit().weight(.semibold))
                    .frame(width: 28, alignment: .trailing)
            }
            .padding(12)
            .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.line)
            }

            VStack(alignment: .leading, spacing: 10) {
                SectionHeaderText(text: "Seats")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(seats, id: \.role) { seat in
                        RoleSeatRow(role: seat.role, brief: seat.brief)
                    }
                }
            }

            Button {
                if isRunning {
                    cancelRoundtable()
                } else {
                    Task { await startRoundtable() }
                }
            } label: {
                HStack(spacing: 8) {
                    if isRunning {
                        ProgressView()
                            .tint(AppTheme.reverseInk)
                    }
                    Label(isRunning ? "停止圆桌" : "开始圆桌", systemImage: isRunning ? "stop.circle" : "person.3.sequence")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(isRunning ? AppTheme.alert : AppTheme.brass)
            .disabled(topicText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isRunning)
            .id("run-button")

            RoundtableRunStatus(
                status: statusMessage,
                error: runError,
                eventCount: events.count,
                isRunning: isRunning
            )
        }
    }

    private var discussionArea: some View {
        VStack(spacing: 14) {
            RoundtableThreadPanel(
                project: project,
                topic: topicText,
                status: statusMessage,
                error: runError,
                events: discussionEvents,
                isRunning: isRunning,
                onSendReply: sendRoundtableReply
            )

            MeetingRecordPanel(
                topic: topicText,
                status: statusMessage,
                error: runError,
                events: events,
                isRunning: isRunning,
                isExpanded: $isRecordExpanded
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
            .frame(maxHeight: isRecordExpanded ? 360 : 136)
        }
        .padding(.top, 16)
        .background(AppTheme.page)
    }

    private var discussionEvents: [RoundtableEvent] {
        session.discussionEvents
    }

    private var session: RoundtableSessionState {
        appState.roundtableSession(projectSlug: project.slug, phase: project.phase)
    }

    private var topic: Binding<String> {
        Binding(
            get: { session.topic },
            set: { appState.updateRoundtableTopic(projectSlug: project.slug, phase: project.phase, topic: $0) }
        )
    }

    private var maxRounds: Binding<Int> {
        Binding(
            get: { session.maxRounds },
            set: { appState.updateRoundtableMaxRounds(projectSlug: project.slug, phase: project.phase, maxRounds: $0) }
        )
    }

    private var topicText: String { session.topic }
    private var events: [RoundtableEvent] { session.events }
    private var isRunning: Bool { session.isRunning }
    private var statusMessage: String { session.statusMessage }
    private var runError: String? { session.runError }

    private var seats: [(role: String, brief: String)] {
        [
            ("architect", "结构和因果"),
            ("character", "人物心理"),
            ("editor", "取舍和风险"),
            ("reader", "读者体验"),
            ("continuity", "设定连续性"),
        ]
    }

    private func startRoundtable() async {
        guard !isRunning else { return }
        let trimmedTopic = topicText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTopic.isEmpty else { return }
#if canImport(UIKit)
        KeyboardDismissal.dismiss()
#endif
        if horizontalSizeClass == .compact {
            isThreadOpen = true
        }
        isRecordExpanded = false
        await appState.startRoundtable(projectSlug: project.slug, phase: project.phase)
    }

    private func cancelRoundtable() {
        appState.cancelRoundtable(projectSlug: project.slug, phase: project.phase)
    }

    private func sendRoundtableReply(_ message: String) {
        Task {
            await appState.continueRoundtable(projectSlug: project.slug, phase: project.phase, message: message)
        }
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
                .foregroundStyle(error == nil ? AppTheme.brass : AppTheme.alert)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                Text(error ?? status)
                    .font(AppTheme.prose(14))
                    .foregroundStyle(error == nil ? AppTheme.ink : AppTheme.alert)
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
                .stroke(error == nil ? AppTheme.line : AppTheme.alert.opacity(0.45))
        }
    }
}

private struct DiscussionThreadSummary: View {
    let status: String
    let error: String?
    let events: [RoundtableEvent]
    let isRunning: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            SurfacePanel {
                HStack(alignment: .center, spacing: 14) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(AppTheme.ui(24, weight: .semibold))
                        .foregroundStyle(error == nil ? AppTheme.brass : AppTheme.alert)
                        .frame(width: 34)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Text("圆桌讨论")
                                .font(AppTheme.title(19))
                            if isRunning {
                                ProgressView()
                                    .scaleEffect(0.78)
                            }
                        }
                        Text(events.isEmpty ? status : "\(events.count) 条发言 · \(status)")
                            .font(AppTheme.ui(12, weight: .medium))
                            .foregroundStyle(error == nil ? AppTheme.muted : AppTheme.alert)
                            .lineLimit(1)
                        Text(latestText)
                            .font(AppTheme.prose(15))
                            .foregroundStyle(AppTheme.ink)
                            .lineLimit(3)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(AppTheme.ui(15, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var latestText: String {
        if let error {
            return error
        }
        if let content = events.last?.message?.content {
            return content
        }
        return "尚无发言"
    }
}

private struct MeetingRecordPanel: View {
    let topic: String
    let status: String
    let error: String?
    let events: [RoundtableEvent]
    let isRunning: Bool
    @Binding var isExpanded: Bool

    var body: some View {
        SurfacePanel {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(AppTheme.ui(18, weight: .semibold))
                        .foregroundStyle(error == nil ? AppTheme.brass : AppTheme.alert)
                        .frame(width: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("会议记录")
                            .font(AppTheme.title(18))
                        Text(events.isEmpty ? status : "\(events.count) 条事件 · \(status)")
                            .font(AppTheme.ui(12, weight: .medium))
                            .foregroundStyle(error == nil ? AppTheme.muted : AppTheme.alert)
                            .lineLimit(1)
                    }
                    Spacer()
                    if isRunning {
                        ProgressView()
                            .scaleEffect(0.82)
                    }
                }

                if !topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(topic)
                        .font(AppTheme.prose(15))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(3)
                }

                if let summary {
                    Divider()
                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeaderText(text: "Summary")
                        Text(summary)
                            .font(AppTheme.prose(15))
                            .foregroundStyle(AppTheme.ink)
                            .lineSpacing(5)
                            .lineLimit(isExpanded ? nil : 4)
                            .textSelection(.enabled)
                    }
                }

                if !events.isEmpty {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isExpanded.toggle()
                        }
                    } label: {
                        Label(isExpanded ? "收起事件" : "查看事件", systemImage: isExpanded ? "chevron.up" : "chevron.down")
                            .font(AppTheme.ui(13, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(AppTheme.brass)
                }

                if isExpanded {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(events) { event in
                            RoundtableLogRow(event: event)
                                .id(event.id)
                        }
                    }
                }
            }
        }
    }

    private var summary: String? {
        events.reversed().compactMap { event -> String? in
            if event.type == "chronicler_done", let content = event.message?.content {
                return content
            }
            if event.message?.role == "chronicler" {
                return event.message?.content
            }
            return nil
        }.first
    }
}

private struct RoundtableThreadView: View {
    let project: Project
    let topic: String
    let status: String
    let error: String?
    let events: [RoundtableEvent]
    let isRunning: Bool
    let onCancel: () -> Void
    let onSendReply: (String) -> Void

    var body: some View {
        RoundtableThreadPanel(
            project: project,
            topic: topic,
            status: status,
            error: error,
            events: events,
            isRunning: isRunning,
            onCancel: onCancel,
            onSendReply: onSendReply
        )
        .navigationTitle("圆桌讨论")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isRunning {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onCancel) {
                        Label("停止", systemImage: "stop.circle")
                    }
                    .foregroundStyle(AppTheme.alert)
                }
            }
        }
    }
}

private struct RoundtableThreadPanel: View {
    let project: Project
    let topic: String
    let status: String
    let error: String?
    let events: [RoundtableEvent]
    let isRunning: Bool
    var onCancel: (() -> Void)? = nil
    var onSendReply: ((String) -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(project.title)
                        .font(AppTheme.title(18))
                        .lineLimit(1)
                    Spacer()
                    Text(events.isEmpty ? status : "\(events.count) 条发言")
                        .font(AppTheme.ui(12, weight: .medium))
                        .foregroundStyle(error == nil ? AppTheme.muted : AppTheme.alert)
                        .lineLimit(1)
                    if isRunning, let onCancel {
                        Button(action: onCancel) {
                            Image(systemName: "stop.circle")
                                .font(AppTheme.ui(17, weight: .semibold))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(AppTheme.alert)
                        .accessibilityLabel("停止圆桌")
                    }
                }
                if !topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(topic)
                        .font(AppTheme.prose(14))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(AppTheme.paper)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(AppTheme.line)
                    .frame(height: 1)
            }

            RoundtableMessagesView(
                events: events,
                status: status,
                error: error,
                isRunning: isRunning
            )

            if let onSendReply {
                RoundtableReplyBar(isRunning: isRunning, onSend: onSendReply)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.page)
    }
}

private struct RoundtableReplyBar: View {
    let isRunning: Bool
    let onSend: (String) -> Void
    @State private var text = ""

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("回复圆桌，或回答 agent 的追问", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(AppTheme.prose(16))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1...4)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(AppTheme.paper, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(AppTheme.line)
                }

            Button {
                send()
            } label: {
                Image(systemName: isRunning ? "hourglass" : "arrow.up.circle.fill")
                    .font(AppTheme.ui(28, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(canSend ? AppTheme.brass : AppTheme.muted)
            .disabled(!canSend)
            .accessibilityLabel("发送回复")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(AppTheme.surface)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(AppTheme.line)
                .frame(height: 1)
        }
    }

    private var canSend: Bool {
        !isRunning && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        text = ""
#if canImport(UIKit)
        KeyboardDismissal.dismiss()
#endif
        onSend(trimmed)
    }
}

private struct RoundtableMessagesView: View {
    let events: [RoundtableEvent]
    let status: String
    let error: String?
    let isRunning: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if events.isEmpty {
                        EmptyDiscussionView(hasEvents: false, status: error ?? status)
                    } else {
                        ForEach(events) { event in
                            RoundtableMessageRow(event: event)
                                .id(event.id)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
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

private struct RoundtableMessageRow: View {
    let event: RoundtableEvent

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            avatar
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(AppTheme.ui(12, weight: .semibold))
                        .foregroundStyle(tint)
                    if let round = event.round {
                        Text("第 \(round) 轮")
                            .font(AppTheme.ui(10, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                }

                Text(bodyText)
                    .font(AppTheme.prose(17))
                    .foregroundStyle(event.type == "error" ? AppTheme.alert : AppTheme.ink)
                    .lineSpacing(6)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(bubbleColor, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(event.type == "error" ? AppTheme.alert.opacity(0.45) : AppTheme.line)
                    }
            }
            .frame(maxWidth: 620, alignment: .leading)
            Spacer(minLength: 22)
        }
    }

    private var avatar: some View {
        Text(title.prefix(1))
            .font(AppTheme.title(13))
            .foregroundStyle(AppTheme.reverseInk)
            .frame(width: 30, height: 30)
            .background(tint, in: Circle())
    }

    private var title: String {
        if let message = event.message {
            return WorkflowRole.alias(message.role)
        }
        if let label = event.label {
            return label
        }
        return event.type == "error" ? "错误" : event.type
    }

    private var bodyText: String {
        if let content = event.message?.content {
            return content
        }
        if let error = event.error {
            return error
        }
        if let topic = event.topic {
            return topic
        }
        return event.type
    }

    private var bubbleColor: Color {
        event.type == "error" ? AppTheme.alert.opacity(0.10) : AppTheme.paper
    }

    private var tint: Color {
        if event.type == "error" {
            return AppTheme.alert
        }
        if let role = event.message?.role ?? event.role {
            return AppTheme.roleTint(role)
        }
        return AppTheme.brass
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
                    .foregroundStyle(event.type == "error" ? AppTheme.alert : AppTheme.muted)
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
        case "human_done": return "你的回复"
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
        case "error": AppTheme.alert
        case "chronicler_done": AppTheme.warning
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
