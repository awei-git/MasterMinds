import type { RoleName } from "@/lib/agents/roles";

export type PhaseKey = "conception" | "bible" | "structure" | "scriptment" | "expansion";

export type WorkMode = "roundtable" | "writing" | "review";

export interface PhaseDefinition {
  key: PhaseKey;
  label: string;
  goal: string;
  mode: WorkMode;
  roundtableRoles: RoleName[];
  writingRole?: RoleName;
  outputArtifact: string;
  confirmationGate: string;
}

export interface AgentDefinition {
  role: RoleName;
  label: string;
  alias: string;
  responsibility: string;
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  { role: "idea", label: "点子", alias: "灵犀", responsibility: "核心概念、主题角度、故事种子" },
  { role: "architect", label: "故事建筑师", alias: "鲁班", responsibility: "结构、节奏、情节弧线、beat sheet" },
  { role: "character", label: "角色总监", alias: "画皮", responsibility: "角色心理、声音一致性、关系网络" },
  { role: "writer", label: "写手", alias: "妙笔", responsibility: "独立写作：散文、scriptment、逐章扩写" },
  { role: "editor", label: "主编", alias: "铁面", responsibility: "结构、语言、信息经济审稿" },
  { role: "reader", label: "第一读者", alias: "知音", responsibility: "翻页欲、无聊点、困惑点" },
  { role: "continuity", label: "连续性检查", alias: "掌故", responsibility: "事实追踪、时间线、前后一致性" },
  { role: "chronicler", label: "史官", alias: "史官", responsibility: "讨论纪要归纳，不参与创作争论" },
];

export const PHASES: PhaseDefinition[] = [
  {
    key: "conception",
    label: "构思",
    goal: "锁定 logline、核心冲突、主题。",
    mode: "roundtable",
    roundtableRoles: ["idea", "architect", "character"],
    outputArtifact: "phases/conception.md",
    confirmationGate: "创作者确认构思纪要后进入世界与角色。",
  },
  {
    key: "bible",
    label: "世界与角色",
    goal: "锁定角色档案、世界设定、规则。",
    mode: "writing",
    roundtableRoles: ["character", "idea", "architect"],
    writingRole: "character",
    outputArtifact: "bible/",
    confirmationGate: "创作者确认角色档案和世界规则后进入结构。",
  },
  {
    key: "structure",
    label: "结构",
    goal: "锁定 beat sheet、章节大纲、张力曲线。",
    mode: "writing",
    roundtableRoles: ["architect", "editor", "reader"],
    writingRole: "architect",
    outputArtifact: "structure/beats.json + structure/outline.md",
    confirmationGate: "创作者确认结构纪要和 beat sheet 后进入 scriptment。",
  },
  {
    key: "scriptment",
    label: "全文速写",
    goal: "用目标字数 25-30% 写一个完整、可读的压缩版故事。",
    mode: "review",
    roundtableRoles: ["editor", "reader", "architect"],
    writingRole: "writer",
    outputArtifact: "scriptment/scriptment.md",
    confirmationGate: "创作者确认 scriptment 结构后进入逐章扩写。",
  },
  {
    key: "expansion",
    label: "逐章扩写",
    goal: "以 scriptment 为骨架，逐章扩写到完整散文，并在每章内完成 briefing、写作、审稿、修改闭环。",
    mode: "writing",
    roundtableRoles: ["character", "architect", "editor"],
    writingRole: "writer",
    outputArtifact: "expansion/chapters/",
    confirmationGate: "所有章节完成后可进入可选全文终审。",
  },
];

export const PHASE_ORDER = PHASES.map((phase) => phase.key);

export const PHASE_LABELS: Record<PhaseKey, string> = Object.fromEntries(
  PHASES.map((phase) => [phase.key, phase.label]),
) as Record<PhaseKey, string>;

export const ROUND_TABLE_PROTOCOL = `# 圆桌讨论协议（硬规则）

你在开会，不是写报告。

1. 每次发言不超过 3 个要点，每个要点一句话。
2. 同意就说“同意”，不要复述别人的观点。
3. 不同意就说清楚哪里不同意，一句话说理由。
4. 不要输出示例文本，不要写段落，不要展开论述。
5. 具体文本写作在讨论之外单独做，讨论只做决策。
6. 回应前面的人再说你自己的，不要忽略别人的发言。
7. 用你的角色视角说话，不要当万能评论员。

格式：
- 要点一
- 要点二
- 但是：xxx`;

export const SCRIPTMENT_REVIEW_PROTOCOL = `# Scriptment 结构审稿硬规则

必须强制检查三个维度：

## 1. 信息经济检测
逐场景列出该场景给读者的新信息；已出现过的信息标记 [REDUNDANT]；三次以上重复标记 [P0-REDUNDANT]。

## 2. 场景功能检查
每个场景必须推进至少两个维度：剧情推进、人物深化、氛围主题、悬念设置解答。只推进一个维度标记 [WEAK-SCENE]，零维度标记 [P0-NO-FUNCTION]。

## 3. 跨场景重复扫描
相同物理动作、意象、对话跨场景重复：第一次正常，第二次标记 [ECHO]，第三次标记 [P0-REPETITION]。`;

export const EXPANSION_PROTOCOL = `# 逐章扩写协议

写作单位是章，不是 beat。

每章流程：
1. Pre-Briefing Roundtable：character 给角色声音 DNA、关系状态、不要重复的细节；architect 给本章结构功能、上下章衔接、scriptment 对应段落。
2. Writer 独立扩写：必须看到 scriptment 全文、最近 2 章全文、更早章节摘要、相关 bible、briefing、style guide。
3. Post-Review Roundtable：editor 检查骨架对齐、语言问题、字数；character 验证声音一致性。
4. 史官归纳。
5. 有问题则 writer 修改后再审，最多 3 轮。`;

export function phaseIndex(phase: string): number {
  return PHASE_ORDER.indexOf(normalizePhase(phase));
}

export function normalizePhase(phase?: string | null): PhaseKey {
  if (phase === "draft" || phase === "review" || phase === "revision" || phase === "final") {
    return "expansion";
  }
  if (phase && (PHASE_ORDER as string[]).includes(phase)) return phase as PhaseKey;
  return "conception";
}

export function nextPhase(phase: string): PhaseKey | null {
  const idx = phaseIndex(phase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

export function phaseDefinition(phase: string): PhaseDefinition {
  const normalized = normalizePhase(phase);
  return PHASES.find((p) => p.key === normalized) ?? PHASES[0];
}

export function roleAlias(role: string): string {
  return AGENT_DEFINITIONS.find((agent) => agent.role === role)?.alias ?? role;
}

export function discussionTopicForPhase(phase: string): string {
  const def = phaseDefinition(phase);
  if (def.key === "scriptment") {
    return "信息经济、场景功能、跨场景重复";
  }
  if (def.key === "expansion") {
    return "章节 briefing、骨架对齐、声音一致性";
  }
  return def.goal;
}

export function phaseSystemPrompt(phase: string): string {
  const def = phaseDefinition(phase);
  const next = nextPhase(def.key);
  const nextLabel = next ? PHASE_LABELS[next] : null;
  const parts = [
    `# 当前阶段：${def.label}`,
    def.goal,
    "",
    "讨论和写作必须严格分离：圆桌只做决策；散文、档案、beat sheet、scriptment、章节正文必须作为独立写作任务执行。",
    `本阶段圆桌成员：${def.roundtableRoles.map(roleAlias).join("、")}。`,
    `本阶段确认门：${def.confirmationGate}`,
  ];
  if (nextLabel) {
    parts.push(`不要自动推进阶段；只有创作者确认纪要后，才进入「${nextLabel}」。`);
  }
  if (def.key === "scriptment") parts.push(SCRIPTMENT_REVIEW_PROTOCOL);
  if (def.key === "expansion") parts.push(EXPANSION_PROTOCOL);
  return parts.join("\n");
}

export function writingTaskPrompt(kind: string): string {
  const prompts: Record<string, string> = {
    bible_draft:
      "请基于已确认的构思纪要，独立起草角色档案和世界规则。必须包含 want/need/flaw/ghost/voice DNA、关系张力、世界规则边界。不要写圆桌讨论。",
    bible_revision:
      "请基于圆桌纪要独立修改角色档案和世界规则。只输出可保存的 bible 文档，不要解释过程。",
    beat_sheet:
      "请基于已确认的构思与 bible，独立生成 beat sheet、章节大纲和张力曲线。每个 beat 必须说明功能与之前 vs 之后。",
    beat_revision:
      "请基于圆桌纪要独立修改 beat sheet。保留因果链、承重墙、副线交汇点和张力曲线。",
    scriptment:
      "请单模型单 pass 生成完整 scriptment：目标字数的 25-30%，是压缩版故事，不是大纲。必须包含每个场景的核心动作、关键对话、重要意象、转场。",
    scriptment_revision:
      "请根据结构审稿纪要修改 scriptment。重点处理信息经济、场景功能、跨场景重复。输出完整可读叙事。",
    chapter_briefing:
      "请生成本章 Pre-Briefing：角色声音 DNA、关系状态、不要重复细节、本章结构功能、上下章衔接、scriptment 对应段落。",
    chapter_draft:
      "请按逐章扩写协议写完整一章。必须以 scriptment 为骨架，参考最近 2 章全文和更早摘要。直接输出章节正文。",
    chapter_revision:
      "请根据 Post-Review 纪要修改本章。只处理明确问题，守住已写好的段落质感，输出修改后的完整章节。",
    full_review_plan:
      "请做可选全文终审圆桌的修改计划：跨章协调、人物声口、连续性、读者体验。输出计划，不要直接重写全文。",
  };
  return prompts[kind] ?? "请执行本阶段的独立写作任务。讨论与写作分离，只输出任务成果。";
}
