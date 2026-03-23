/**
 * Review Phase — multi-agent parallel review with auto-loop.
 *
 * Flow: 4 agents review in parallel → aggregate issues → pause for user →
 *       writer revises → re-review → loop until P0 resolved or maxRounds.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { complete, stream, type ModelProvider, type StreamCallbacks } from "@/lib/llm";
import { loadRole } from "@/lib/agents/roles";
import { loadSkills } from "@/lib/agents/context";

const DATA_DIR = join(process.cwd(), "data");
const AGENTS_DIR = join(process.cwd(), "agents");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewIssue {
  id: string;
  severity: "P0" | "P1" | "P2";
  source: string;       // which agent
  section: string;      // chapter/section name
  location: string;     // where in text
  description: string;
  suggestion: string;
  status: "open" | "accepted" | "fixed" | "rejected";
}

export interface AgentReview {
  agent: string;
  raw: string;
  issues: ReviewIssue[];
  score?: number;       // reader gives 1-10
}

export interface ReviewRound {
  round: number;
  timestamp: string;
  reviews: Record<string, AgentReview>;
  aggregated: ReviewIssue[];
  userComments?: string;
  userIssueUpdates?: Array<{ id: string; status: string; reason?: string }>;
  status: "reviewing" | "awaiting_input" | "revising" | "complete";
}

export type SendFn = (data: object) => void;

// ---------------------------------------------------------------------------
// Review prompts — appended to each role's system prompt
// ---------------------------------------------------------------------------

const REVIEW_PROMPTS: Record<string, string> = {
  editor: `
## 审稿模式

你现在进入审稿模式。请审阅完整稿件，按严重程度输出问题清单。

### 输出格式（严格遵守）

P0（必须修）：
- [章节名] [段落位置] 问题描述 → 建议修改方向

P1（应该修）：
- [章节名] [段落位置] 问题描述 → 建议修改方向

P2（可以修）：
- [章节名] [段落位置] 问题描述 → 建议修改方向

### 整体评价
（50字以内）

注意：只列真问题。不要为了显得认真而凑数。
`,

  character: `
## 角色审查模式

审阅完整稿件，专注于角色相关问题。

### 检查项
1. 角色声音是否一致（同一人在不同章节说话方式是否统一）
2. 角色弧是否完整（有没有设了悬念没收的）
3. 对话是否真实（是不是每个人说话都一个味道）
4. 角色关系变化是否可信（有没有突然跳跃的关系转变）
5. 角色动机是否清晰（读者能理解角色为什么这么做吗）

### 输出格式

P0（必须修）：
- [章节名] [角色名] 问题描述 → 建议修改方向

P1（应该修）：
- [章节名] [角色名] 问题描述 → 建议修改方向

P2（可以修）：
- [章节名] [角色名] 问题描述 → 建议修改方向

### 角色一致性评分（每个主要角色1-10分，附一句理由）
`,

  reader: `
## 读者审查模式

以第一读者的身份完整阅读稿件。不用专业术语，用你真实的感受。

### 请回答
1. 你在哪里想跳过？（精确到章节和段落）
2. 你在哪里被打动了？
3. 你在哪里困惑了？
4. 你读完后最记得什么？
5. 你会不会推荐给朋友？为什么？

### 输出格式

P0（阅读体验致命伤）：
- [章节名] [位置] 问题描述

P1（阅读体验减分项）：
- [章节名] [位置] 问题描述

P2（锦上添花）：
- [章节名] [位置] 建议

### 整体评分：X/10
### 一句话总评：
`,

  continuity: `
## 连续性审查模式

逐章检查事实一致性。你关心的是：前面说了A，后面不能变成B。

### 检查项
1. 人名、地名、时间是否前后一致
2. 角色外貌/特征描述是否矛盾
3. 事件时间线是否合理
4. 空间布局是否自洽（角色从A到B的路径）
5. 角色知道什么、不知道什么——有没有信息泄漏

### 输出格式

P0（事实矛盾）：
- [章节A vs 章节B] 矛盾描述

P1（可能矛盾/模糊）：
- [章节] 描述

P2（建议补充细节以避免歧义）：
- [章节] 描述

### 时间线摘要（如有问题请标红）
`,
};

// ---------------------------------------------------------------------------
// Build system prompt for review mode
// ---------------------------------------------------------------------------

function buildReviewSystem(role: string): string {
  const parts: string[] = [loadRole(role as any).systemPrompt];
  const skills = loadSkills(role as any);
  if (skills) parts.push(skills);

  // Add review-mode prompt
  const reviewPrompt = REVIEW_PROMPTS[role];
  if (reviewPrompt) parts.push(reviewPrompt);

  // Add checklists for editor
  if (role === "editor") {
    const antiAi = readIfExists(join(AGENTS_DIR, "checklists", "anti-ai.md"));
    if (antiAi) parts.push(antiAi);
    const selfEdit = readIfExists(join(AGENTS_DIR, "checklists", "self-edit.md"));
    if (selfEdit) parts.push(selfEdit);
  }

  return parts.join("\n\n---\n\n");
}

function readIfExists(path: string): string | null {
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return null;
}

// ---------------------------------------------------------------------------
// Load full draft for review
// ---------------------------------------------------------------------------

export function loadFullDraft(projectSlug: string): string {
  const draftDir = join(DATA_DIR, projectSlug, "draft");
  if (!existsSync(draftDir)) return "";

  const { readdirSync } = require("fs");
  const files = readdirSync(draftDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort();

  const parts: string[] = [];
  for (const file of files) {
    const content = readFileSync(join(draftDir, file), "utf-8");
    parts.push(`## ${file.replace(".md", "")}\n\n${content}`);
  }
  return parts.join("\n\n---\n\n");
}

// Load bible/character context for character reviewer
function loadBibleContext(projectSlug: string): string {
  const bibleDir = join(DATA_DIR, projectSlug, "bible");
  if (!existsSync(bibleDir)) return "";

  const parts: string[] = [];
  const charDir = join(bibleDir, "characters");
  if (existsSync(charDir)) {
    const { readdirSync } = require("fs");
    for (const f of readdirSync(charDir)) {
      if (f.endsWith(".md")) {
        parts.push(readFileSync(join(charDir, f), "utf-8"));
      }
    }
  }
  return parts.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Parse issues from agent output
// ---------------------------------------------------------------------------

export function parseIssues(raw: string, source: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let issueCounter = 0;

  // Match lines like: - [章节名] [位置] 描述 → 建议
  // or: - [章节名] 描述 → 建议
  const lines = raw.split("\n");
  let currentSeverity: "P0" | "P1" | "P2" = "P1";

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect severity headers
    if (/^P0[（(]/.test(trimmed) || /^###?\s*P0/.test(trimmed)) {
      currentSeverity = "P0";
      continue;
    }
    if (/^P1[（(]/.test(trimmed) || /^###?\s*P1/.test(trimmed)) {
      currentSeverity = "P1";
      continue;
    }
    if (/^P2[（(]/.test(trimmed) || /^###?\s*P2/.test(trimmed)) {
      currentSeverity = "P2";
      continue;
    }

    // Match issue lines
    const issueMatch = trimmed.match(/^[-*]\s*\[([^\]]+)\]\s*(?:\[([^\]]*)\]\s*)?(.+)/);
    if (issueMatch) {
      issueCounter++;
      const section = issueMatch[1];
      const location = issueMatch[2] || "";
      const rest = issueMatch[3];

      // Split on → for suggestion
      const [description, suggestion] = rest.split(/[→→]/).map(s => s.trim());

      issues.push({
        id: `${source}_${String(issueCounter).padStart(3, "0")}`,
        severity: currentSeverity,
        source,
        section,
        location,
        description: description || rest,
        suggestion: suggestion || "",
        status: "open",
      });
    }
  }

  return issues;
}

// Parse reader score
export function parseReaderScore(raw: string): number | undefined {
  const match = raw.match(/整体评分[：:]\s*(\d+(?:\.\d+)?)\s*[/／]\s*10/);
  if (match) return parseFloat(match[1]);
  const match2 = raw.match(/(\d+(?:\.\d+)?)\s*[/／]\s*10/);
  if (match2) return parseFloat(match2[1]);
  return undefined;
}

// ---------------------------------------------------------------------------
// Model routing for review
// ---------------------------------------------------------------------------

function routeReviewProvider(role: string, base: ModelProvider): ModelProvider {
  if (base !== "claude-code") return base;
  // GPT quota often exhausted; Gemini unreliable for long review
  // Use claude-code for editor, deepseek for reasoning-heavy roles
  const map: Record<string, ModelProvider> = {
    editor: "claude-code",
    character: "claude-code",
    reader: "deepseek",
    continuity: "deepseek",
    writer: "claude-code",
  };
  return map[role] ?? "claude-code";
}

// ---------------------------------------------------------------------------
// Single agent review (streaming)
// ---------------------------------------------------------------------------

export async function reviewWithAgent(
  role: string,
  fullDraft: string,
  projectSlug: string,
  provider: ModelProvider,
  send: SendFn,
): Promise<AgentReview> {
  const label = { editor: "铁面", character: "画皮", reader: "知音", continuity: "掌故" }[role] || role;
  send({ type: "agent_start", agent: role, label: `${label} · 审阅` });

  const system = buildReviewSystem(role);
  const routed = routeReviewProvider(role, provider);

  // Add bible context for character reviewer
  let userContent = `请审阅以下完整稿件：\n\n${fullDraft}`;
  if (role === "character") {
    const bible = loadBibleContext(projectSlug);
    if (bible) {
      userContent = `## 角色档案\n\n${bible}\n\n---\n\n## 完整稿件\n\n${fullDraft}`;
    }
  }

  let fullOutput = "";
  await stream(routed, [
    { role: "user", content: userContent },
  ], {
    system,
    thinking: role === "editor",
  }, {
    onText: (token) => {
      fullOutput += token;
      send({ type: "agent_chunk", agent: role, content: token });
    },
    onDone: (text) => {
      fullOutput = text || fullOutput;
      send({ type: "agent_stream_done", agent: role });
    },
  });

  const issues = parseIssues(fullOutput, role);
  const score = role === "reader" ? parseReaderScore(fullOutput) : undefined;

  send({ type: "agent_done", agent: role, issueCount: issues.length, score });

  return { agent: role, raw: fullOutput, issues, score };
}

// ---------------------------------------------------------------------------
// Aggregate issues from all reviewers
// ---------------------------------------------------------------------------

export function aggregateIssues(reviews: Record<string, AgentReview>): ReviewIssue[] {
  const all: ReviewIssue[] = [];
  for (const review of Object.values(reviews)) {
    all.push(...review.issues);
  }
  // Sort: P0 first, then P1, then P2
  const order = { P0: 0, P1: 1, P2: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity]);
  return all;
}

// ---------------------------------------------------------------------------
// Save/load review state
// ---------------------------------------------------------------------------

export function saveReviewRound(projectSlug: string, round: ReviewRound): void {
  const dir = join(DATA_DIR, projectSlug, "reviews");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `round_${round.round}.json`),
    JSON.stringify(round, null, 2),
    "utf-8"
  );
}

export function loadReviewRound(projectSlug: string, round: number): ReviewRound | null {
  const path = join(DATA_DIR, projectSlug, "reviews", `round_${round}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ---------------------------------------------------------------------------
// Writer revision based on review issues
// ---------------------------------------------------------------------------

/**
 * Load individual chapter files from draft directory.
 */
export function loadChapters(projectSlug: string): Array<{ name: string; content: string; path: string }> {
  const draftDir = join(DATA_DIR, projectSlug, "draft");
  if (!existsSync(draftDir)) return [];
  const { readdirSync } = require("fs");
  return readdirSync(draftDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort()
    .map((f: string) => ({
      name: f.replace(".md", ""),
      content: readFileSync(join(draftDir, f), "utf-8"),
      path: join(draftDir, f),
    }));
}

/**
 * Build a condensed review summary relevant to a specific chapter.
 */
function extractChapterIssues(chapterName: string, rawReviews: Record<string, AgentReview>): string {
  const labels: Record<string, string> = { editor: "铁面", character: "画皮", reader: "知音", continuity: "掌故" };
  const parts: string[] = [];
  for (const [agent, review] of Object.entries(rawReviews)) {
    if (!review.raw || review.raw.startsWith("Error")) continue;
    // Extract paragraphs mentioning this chapter
    const lines = review.raw.split("\n");
    const relevant: string[] = [];
    for (const line of lines) {
      if (line.includes(chapterName) || line.includes("全稿") || line.includes("全文") ||
          /P0|P1/.test(line)) {
        relevant.push(line);
      }
    }
    if (relevant.length > 0) {
      parts.push(`**${labels[agent] || agent}**:\n${relevant.join("\n")}`);
    }
  }
  return parts.join("\n\n") || "无针对本章的具体意见";
}

/**
 * Revise chapter by chapter based on review feedback.
 * Saves each revised chapter back to disk.
 */
export async function reviseFromIssues(
  fullDraft: string,
  issues: ReviewIssue[],
  projectSlug: string,
  provider: ModelProvider,
  send: SendFn,
  rawReviews?: Record<string, AgentReview>,
): Promise<string> {
  send({ type: "revise_start" });

  const chapters = loadChapters(projectSlug);
  if (chapters.length === 0) {
    send({ type: "revise_done" });
    return fullDraft;
  }

  // Build full review context (condensed)
  let reviewSummary = "";
  if (rawReviews) {
    const labels: Record<string, string> = { editor: "铁面", character: "画皮", reader: "知音", continuity: "掌故" };
    const parts: string[] = [];
    for (const [agent, review] of Object.entries(rawReviews)) {
      if (review.raw && !review.raw.startsWith("Error")) {
        // Only keep P0/P1 sections and overall assessment (truncate to 1500 chars per agent)
        parts.push(`### ${labels[agent] || agent}\n\n${review.raw.slice(0, 1500)}`);
      }
    }
    reviewSummary = parts.join("\n\n---\n\n");
  }

  const system = buildReviewSystem("writer");
  const routed = routeReviewProvider("writer", provider);
  const revisedParts: string[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const chapterIssues = rawReviews ? extractChapterIssues(ch.name, rawReviews) : "";

    // Skip chapters with no issues mentioned
    if (chapterIssues === "无针对本章的具体意见" && !reviewSummary.includes(ch.name)) {
      send({ type: "chapter_skip", chapter: ch.name, reason: "无相关审稿意见" });
      revisedParts.push(ch.content);
      continue;
    }

    send({ type: "chapter_revise_start", chapter: ch.name, index: i + 1, total: chapters.length });

    // BACKUP original before any modification
    const backupDir = join(DATA_DIR, projectSlug, "draft", ".backup");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, `${ch.name}.md`), ch.content, "utf-8");

    let revised = "";
    await stream(routed, [
      {
        role: "user",
        content: `修改以下章节。只改审稿意见指出的问题，其他不要动。

⚠️ 改稿铁律（违反任何一条则修改无效）：
1. 只改审稿意见明确指出的问题，不要动其他地方
2. 有问题的地方要改好，不能删掉了事——删除不是修改
3. 修改方向是写得更好，不是写得更短更安全
4. 禁止把长句拆成碎片短句，禁止删掉具体意象换成概括
5. 修改后的章节不应比原文短超过10%
6. 直接输出修改后的完整章节正文，不要加任何说明

## 本章审稿意见

${chapterIssues}

## 原文：${ch.name}

${ch.content}`,
      },
    ], {
      system,
      thinking: true,
    }, {
      onText: (token) => {
        revised += token;
        send({ type: "revise_chunk", chapter: ch.name, content: token });
      },
      onDone: (text) => {
        revised = text || revised;
      },
    });

    // Iron rule: reject if more than 10% shorter than original
    const shrinkRatio = revised.length / ch.content.length;
    if (revised.length > 0 && shrinkRatio >= 0.9) {
      writeFileSync(ch.path, revised, "utf-8");
      revisedParts.push(revised);
      send({ type: "chapter_revise_done", chapter: ch.name, oldLen: ch.content.length, newLen: revised.length });
    } else if (revised.length > 0 && shrinkRatio < 0.9) {
      // Rejected — too much deleted. Restore from backup.
      revisedParts.push(ch.content);
      send({
        type: "chapter_revise_rejected",
        chapter: ch.name,
        reason: `修改被拒绝：缩减了${Math.round((1 - shrinkRatio) * 100)}%（超过10%上限）。问题要改不能删。保留原文。`,
        oldLen: ch.content.length,
        newLen: revised.length,
      });
    } else {
      revisedParts.push(ch.content);
      send({ type: "chapter_revise_skip", chapter: ch.name, reason: "修改结果为空，保留原文" });
    }
  }

  send({ type: "revise_done", totalChapters: chapters.length });
  return revisedParts.map((p, i) => `## ${chapters[i].name}\n\n${p}`).join("\n\n---\n\n");
}
