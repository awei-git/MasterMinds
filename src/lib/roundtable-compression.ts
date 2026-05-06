import { roleAlias } from "@/lib/workflow";

export interface RoundtableDigestMessage {
  id?: string;
  role: string;
  content: string;
  model?: string | null;
  phase?: string | null;
  createdAt?: Date | string | null;
}

export interface RoundtableDigestDiscussion {
  id: string;
  topic: string;
  phase: string;
  status: string;
  resolution?: string | null;
  messages: RoundtableDigestMessage[];
}

const CONCLUSION_PATTERNS = [
  /^(结论|判断|建议|我建议|我的建议|倾向|我倾向|同意|不同意|已定|确定|可以定|不能定|需要定|主题句|logline|核心冲突|核心设定|角色定位|结构功能|下一步|待定|风险|缺口|问题|裁决|保留|删除|修改|改成|不要|必须|应该|不应该)\b/i,
  /(结论|建议|倾向|同意|不同意|已定|确定|锁定|待定|风险|缺口|裁决|下一步|必须|不要|保留|删除|修改|改成)/,
  /^[\-\*]\s*(结论|建议|倾向|同意|不同意|已定|确定|锁定|待定|风险|缺口|裁决|下一步|必须|不要|保留|删除|修改|改成)/,
];

const FLUFF_PATTERNS = [
  /^(好的|收到|明白|可以|当然|我来|下面|首先|其次|最后)[，。,.!！\s]*$/,
  /^(从某种意义上|在某种程度上|本质上|深层来看|形而上|哲学上|宏观上)/,
  /(不是简单的.*而是|不是.*而是.*的过程)/,
  /(值得深入探讨|具有丰富的可能性|提供了很大的空间|可以进一步展开)/,
  /(我翻译一下|他们三个说的其实是同一件事|说人话|换句话说)/,
];

function normalizeLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[\-\*\d.、\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCandidateLines(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[。！？!?])\s+/)
    .map(normalizeLine)
    .filter(Boolean);
}

function isUsefulConclusion(line: string): boolean {
  if (line.length < 8) return false;
  if (FLUFF_PATTERNS.some((pattern) => pattern.test(line))) return false;
  return CONCLUSION_PATTERNS.some((pattern) => pattern.test(line));
}

function compactLine(line: string, maxChars = 180): string {
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1).trim()}…`;
}

function uniquePush(lines: string[], value: string, max: number): void {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || lines.includes(normalized)) return;
  if (lines.length < max) lines.push(normalized);
}

function conclusionLinesForMessage(message: RoundtableDigestMessage, maxPerMessage: number): string[] {
  const picked: string[] = [];
  for (const line of splitCandidateLines(message.content)) {
    if (isUsefulConclusion(line)) {
      uniquePush(picked, compactLine(line), maxPerMessage);
    }
  }

  if (picked.length === 0) {
    const firstConcrete = splitCandidateLines(message.content)
      .find((line) => line.length >= 16 && !FLUFF_PATTERNS.some((pattern) => pattern.test(line)));
    if (firstConcrete) picked.push(compactLine(firstConcrete, 160));
  }

  return picked;
}

export function buildRoundtableContextSummary(
  discussion: RoundtableDigestDiscussion | {
    topic: string;
    phase: string;
    status: string;
    resolution?: string | null;
    messages: RoundtableDigestMessage[];
  },
): string {
  if (discussion.status === "resolved" && discussion.resolution?.trim()) {
    return discussion.resolution.trim();
  }

  const humanInputs: string[] = [];
  const conclusions: string[] = [];
  const openItems: string[] = [];

  for (const message of discussion.messages) {
    if (message.role === "chronicler" || message.role === "summary") continue;

    if (message.role === "human") {
      for (const line of splitCandidateLines(message.content)) {
        uniquePush(humanInputs, compactLine(line, 140), 3);
      }
      continue;
    }

    const label = roleAlias(message.role);
    for (const line of conclusionLinesForMessage(message, 3)) {
      const bucket = /(待定|风险|缺口|问题|不同意|裁决|不能定|需要定)/.test(line) ? openItems : conclusions;
      uniquePush(bucket, `${label}: ${line}`, bucket === conclusions ? 8 : 6);
    }
  }

  const parts = [
    `# 未定稿圆桌压缩纪要`,
    "",
    `- 议题：${discussion.topic}`,
    `- 阶段：${discussion.phase}`,
    `- 状态：${discussion.status}`,
    `- 压缩规则：只保留结论、分歧、风险、待定项；删除寒暄、创作理念空话和重复论述。`,
    "",
  ];

  if (humanInputs.length) {
    parts.push("## 创作者输入");
    parts.push(...humanInputs.map((line) => `- ${line}`));
    parts.push("");
  }

  if (conclusions.length) {
    parts.push("## 暂定结论");
    parts.push(...conclusions.map((line) => `- ${line}`));
    parts.push("");
  }

  if (openItems.length) {
    parts.push("## 待定 / 分歧 / 风险");
    parts.push(...openItems.map((line) => `- ${line}`));
    parts.push("");
  }

  if (!conclusions.length && !openItems.length) {
    parts.push("## 可用信息");
    parts.push("- 暂无可进入长期上下文的结论；下一轮应要求成员给出明确判断、依据或待裁决项。");
    parts.push("");
  }

  return parts.join("\n").trim();
}

export function transcriptForPrompt(items: Array<{ role: string; content: string }>): string {
  return items.map((item) => `【${roleAlias(item.role)}】\n${item.content}`).join("\n\n---\n\n");
}

export function compactTranscriptForPrompt(
  discussion: {
    topic: string;
    phase: string;
    status: string;
    resolution?: string | null;
    messages: RoundtableDigestMessage[];
  },
  options: { maxRawMessages?: number; maxRawChars?: number } = {},
): string {
  const maxRawMessages = options.maxRawMessages ?? 6;
  const maxRawChars = options.maxRawChars ?? 3200;
  const totalChars = discussion.messages.reduce((sum, message) => sum + message.content.length, 0);

  if (discussion.status === "resolved" && discussion.resolution?.trim()) {
    return `# 已定稿圆桌结论\n\n${discussion.resolution.trim()}`;
  }

  if (discussion.messages.length <= maxRawMessages && totalChars <= maxRawChars) {
    return transcriptForPrompt(discussion.messages);
  }

  const recent = discussion.messages
    .filter((message) => message.role !== "chronicler" && message.role !== "summary")
    .slice(-2);
  const recentRaw = recent.length ? `\n\n## 最近必要原文\n\n${transcriptForPrompt(recent)}` : "";

  return `${buildRoundtableContextSummary(discussion)}${recentRaw}`;
}

export function compactMessagesForTransport(
  discussion: RoundtableDigestDiscussion,
): RoundtableDigestMessage[] {
  if (discussion.status === "resolved" && discussion.resolution?.trim()) {
    return [{
      id: `${discussion.id}:resolution`,
      role: "summary",
      content: discussion.resolution.trim(),
      phase: discussion.phase,
      createdAt: null,
    }];
  }

  return [{
    id: `${discussion.id}:context-summary`,
    role: "summary",
    content: buildRoundtableContextSummary(discussion),
    phase: discussion.phase,
    createdAt: null,
  }];
}
