import Foundation

struct Project: Identifiable, Codable, Hashable {
    let id: String
    let slug: String
    let title: String
    let type: String
    let phase: String
    let status: String
    let updatedAt: Date

    var phaseLabel: String {
        Workflow.phaseLabel(phase)
    }
}

struct PhaseDefinition: Identifiable, Codable, Hashable {
    let key: String
    let label: String
    let goal: String
    let roundtableRoles: [String]
    let writingRole: String?
    let outputArtifact: String
    let confirmationGate: String

    var id: String { key }
}

struct AgentDefinition: Identifiable, Codable, Hashable {
    let role: String
    let label: String
    let alias: String
    let responsibility: String

    var id: String { role }
}

struct WorkflowResponse: Codable {
    let phases: [PhaseDefinition]
    let agents: [AgentDefinition]
    let roundtableProtocol: String
    let scriptmentReviewProtocol: String
    let expansionProtocol: String
}

struct PhaseSummaryResponse: Codable {
    let content: String?
}

struct WritingTaskResult: Codable {
    let content: String
    let path: String
    let saved: Bool
}

struct SavedArtifactResponse: Codable {
    let content: String?
    let path: String?
}

struct SaveArtifactResponse: Codable {
    let ok: Bool
    let path: String?
}

struct ChapterListResponse: Codable {
    let beats: [ChapterUnit]
}

struct ChapterUnit: Identifiable, Codable, Hashable {
    let id: String
    let chapter: String
    let title: String
    let summary: String
    let key: Bool
    let wordBudget: Int
    let status: String
    let wordCount: Int?

    var statusLabel: String {
        switch status {
        case "blank": "未写"
        case "writing": "写作中"
        case "review": "待审"
        case "revising": "修订中"
        case "done": "完成"
        default: status
        }
    }
}

struct APIErrorResponse: Codable {
    let error: String
}

struct RoundtableMessage: Identifiable, Codable, Hashable {
    let id: String
    let role: String
    let model: String?
    let phase: String?
    let content: String
    let createdAt: Date?
}

struct RoundtableEvent: Identifiable, Codable, Hashable {
    let type: String
    let discussionId: String?
    let phase: String?
    let topic: String?
    let roles: [String]?
    let role: String?
    let label: String?
    let round: Int?
    let error: String?
    let message: RoundtableMessage?

    var id: String {
        [
            type,
            discussionId ?? "",
            role ?? "",
            String(round ?? 0),
            message?.id ?? topic ?? label ?? error ?? "",
        ].joined(separator: "-")
    }
}

enum Workflow {
    static let phases: [String] = ["conception", "bible", "structure", "scriptment", "expansion"]
    static let defaultResponse = WorkflowResponse(
        phases: [
            PhaseDefinition(
                key: "conception",
                label: "构思",
                goal: "确定核心命题、人物关系和项目方向。",
                roundtableRoles: ["story_architect", "character_psychologist", "market_editor"],
                writingRole: nil,
                outputArtifact: "conception_brief",
                confirmationGate: "确认项目命题和叙事承诺"
            ),
            PhaseDefinition(
                key: "bible",
                label: "世界与角色",
                goal: "建立角色档案、世界规则和长期冲突。",
                roundtableRoles: ["story_architect", "character_psychologist", "style_editor"],
                writingRole: "bible_writer",
                outputArtifact: "project_bible",
                confirmationGate: "确认 Bible 可支撑长篇写作"
            ),
            PhaseDefinition(
                key: "structure",
                label: "结构",
                goal: "生成章节大纲、张力曲线和因果链。",
                roundtableRoles: ["plot_doctor", "continuity_editor", "market_editor"],
                writingRole: "structure_writer",
                outputArtifact: "beat_sheet",
                confirmationGate: "确认结构承重墙"
            ),
            PhaseDefinition(
                key: "scriptment",
                label: "全文速写",
                goal: "用压缩全文验证叙事完整性。",
                roundtableRoles: ["scriptment_reviewer", "style_editor", "continuity_editor"],
                writingRole: "scriptment_writer",
                outputArtifact: "scriptment",
                confirmationGate: "确认信息经济和场景功能"
            ),
            PhaseDefinition(
                key: "expansion",
                label: "逐章扩写",
                goal: "以章节为单位写作、修订和审稿。",
                roundtableRoles: ["chapter_editor", "continuity_editor", "style_editor"],
                writingRole: "chapter_writer",
                outputArtifact: "chapter_drafts",
                confirmationGate: "确认章节进入下一轮修订"
            ),
        ],
        agents: [],
        roundtableProtocol: "圆桌讨论需要连接服务器。离线时可以继续编辑章节草稿，并通过 iCloud 同步。",
        scriptmentReviewProtocol: "Scriptment 审稿需要连接服务器。",
        expansionProtocol: "逐章扩写支持离线编辑和 iCloud 慢同步；AI 生成需要服务器。"
    )

    static func phaseLabel(_ key: String) -> String {
        switch key {
        case "conception": "构思"
        case "bible": "世界与角色"
        case "structure": "结构"
        case "scriptment": "全文速写"
        case "expansion", "draft", "review", "revision", "final": "逐章扩写"
        default: key
        }
    }

    static func writingTasks(for phase: String) -> [WritingTaskAction] {
        switch phase {
        case "bible":
            [
                WritingTaskAction(kind: "bible_draft", title: "起草 Bible", subtitle: "角色档案、世界规则、关系张力"),
                WritingTaskAction(kind: "bible_revision", title: "按纪要修 Bible", subtitle: "基于圆桌纪要独立修改"),
            ]
        case "structure":
            [
                WritingTaskAction(kind: "beat_sheet", title: "生成 Beat Sheet", subtitle: "章节大纲、张力曲线、因果链"),
                WritingTaskAction(kind: "beat_revision", title: "按纪要修结构", subtitle: "保留承重墙并修正中段"),
            ]
        case "scriptment":
            [
                WritingTaskAction(kind: "scriptment", title: "生成 Scriptment", subtitle: "25-30% 压缩版完整叙事"),
                WritingTaskAction(kind: "scriptment_revision", title: "按审稿修 Scriptment", subtitle: "信息经济、场景功能、跨场景重复"),
            ]
        case "expansion", "draft", "review", "revision", "final":
            [
                WritingTaskAction(kind: "full_review_plan", title: "生成全稿审稿计划", subtitle: "为逐章扩写后的整稿准备审阅策略"),
            ]
        default:
            []
        }
    }
}

struct WritingTaskAction: Identifiable, Hashable {
    let kind: String
    let title: String
    let subtitle: String

    var id: String { kind }
}
