import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { loadRole, type RoleName } from "./roles";
import type { LLMMessage } from "../llm";

const DATA_DIR = join(process.cwd(), "data");
const AGENTS_DIR = join(process.cwd(), "agents");

// Skills organized by task type — loaded on-demand, not all at once
const SKILL_GROUPS: Record<string, string[]> = {
  // For writing new prose
  drafting: ["scene-level-tension", "dialogue-subtext", "telling-detail", "psychic-distance", "sentence-rhythm"],
  // For revision/rewrite
  revision: ["surgical-revision", "compression", "voice-consistency"],
  // For dialogue-heavy scenes
  dialogue: ["dialogue-subtext", "free-indirect-discourse", "psychic-distance"],
  // For structural/architectural work
  structure: ["strategic-withholding", "scene-level-tension", "image-systems", "earned-ending"],
  // For idea/concept work
  concept: ["novum-extrapolation-chain", "conceptual-metaphor-as-structure", "defamiliarization", "character-desire-contradiction"],
  // For worldbuilding
  world: ["novum-extrapolation-chain", "incluing", "defamiliarization"],
  // For editing/review (editor doesn't need craft skills — it evaluates, not writes)
  editing: ["scene-level-tension", "compression"],
};

// Default skill group per role (can be overridden by task hints)
const ROLE_DEFAULT_SKILLS: Record<string, string> = {
  writer: "drafting",
  editor: "editing",
  idea: "concept",
  architect: "structure",
  character: "dialogue",
  reader: "",      // reader evaluates, doesn't need craft skills
  continuity: "",  // checks facts, not craft
  worldbuilder: "world",
};

function projectDir(slug: string): string {
  return join(DATA_DIR, slug);
}

function readIfExists(path: string): string | null {
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return null;
}

// --- Context slices ---

function loadProjectMemory(slug: string): string {
  const parts: string[] = [];
  const dir = projectDir(slug);

  const pm = readIfExists(join(dir, "memory", "project-memory.md"));
  if (pm) parts.push("# Project Memory\n" + pm);

  const sg = readIfExists(join(dir, "memory", "style-guide.md"));
  if (sg) parts.push("# Style Guide\n" + sg);

  const dec = readIfExists(join(dir, "memory", "decisions.md"));
  if (dec) parts.push("# Key Decisions\n" + dec);

  return parts.join("\n\n---\n\n");
}

export function hasPhaseSummaries(slug: string, currentPhase?: string): boolean {
  const PHASE_ORDER = ["conception", "bible", "structure", "draft", "review", "final"];
  const dir = join(projectDir(slug), "phases");
  const currentIdx = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : PHASE_ORDER.length;
  for (let i = 0; i < currentIdx; i++) {
    if (existsSync(join(dir, `${PHASE_ORDER[i]}.md`))) return true;
  }
  return false;
}

/**
 * Extract only the "✓ 已确定" lines from a phase summary.
 * This compresses a 20KB summary down to ~2-3KB of hard constraints.
 */
function extractConstraints(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inConfirmedSection = false;
  let currentHeading = "";

  for (const line of lines) {
    // Track section headings
    if (line.startsWith("## ") || line.startsWith("### ")) {
      const heading = line.trim();
      // "已确定" or "已确定的内容" sections
      if (heading.includes("已确定")) {
        inConfirmedSection = true;
        currentHeading = heading;
        result.push(heading);
        continue;
      }
      // Sub-headings within confirmed section
      if (inConfirmedSection && line.startsWith("### ")) {
        result.push(heading);
        continue;
      }
      // New top-level section ends confirmed block
      if (line.startsWith("## ") && !heading.includes("已确定")) {
        inConfirmedSection = false;
        continue;
      }
    }

    // Include ✓ lines and table rows (character tables, structure tables)
    if (inConfirmedSection) {
      if (line.startsWith("- ✓") || line.startsWith("| ") || line.startsWith("---")) {
        result.push(line);
      }
    }
  }

  return result.join("\n");
}

function loadPhaseSummaries(slug: string, currentPhase?: string, compact?: boolean): string {
  const PHASE_ORDER = ["conception", "bible", "structure", "draft", "review", "final"];
  const PHASE_LABELS: Record<string, string> = {
    conception: "构思", bible: "世界与角色", structure: "结构",
    draft: "写作", review: "审稿", final: "定稿",
  };
  const dir = join(projectDir(slug), "phases");
  const parts: string[] = [];

  // Load all completed phase summaries (before current phase)
  const currentIdx = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : PHASE_ORDER.length;
  for (let i = 0; i < currentIdx; i++) {
    const phase = PHASE_ORDER[i];
    const content = readIfExists(join(dir, `${phase}.md`));
    if (!content) continue;

    // In compact mode: only extract ✓ confirmed items (for draft/review/final phases)
    const text = compact ? extractConstraints(content) : content;
    if (text.trim()) {
      parts.push(`## ${PHASE_LABELS[phase] ?? phase}阶段\n\n${text}`);
    }
  }

  if (parts.length === 0) return "";
  return `# 已锁定的阶段决策（硬约束）

⚠️ 以下是前序阶段已确定的内容。这些决策具有约束力：
- 构思阶段确定的主题、核心冲突、logline → 不可偏离
- 世界与角色阶段确定的设定、人物、规则 → 不可矛盾
- 结构阶段确定的节拍、大纲 → 不可跳过或重排

如需修改已锁定的决策，必须明确告知创作者并获得确认，不能静默偏离。

` + parts.join("\n\n---\n\n");
}

function loadAgentNotes(slug: string, role: RoleName): string {
  const parts: string[] = [];
  // Global notes (cross-project learned behaviors)
  const globalPath = join(DATA_DIR, "global-agent-notes", `${role}.md`);
  const globalNotes = readIfExists(globalPath);
  if (globalNotes) parts.push("## 全局经验（适用于所有项目）\n" + globalNotes);
  // Project-specific notes
  const projectPath = join(projectDir(slug), "memory", "agent-notes", `${role}.md`);
  const projectNotes = readIfExists(projectPath);
  if (projectNotes) parts.push("## 本项目经验\n" + projectNotes);
  return parts.join("\n\n");
}

function loadBibleSummary(slug: string, characters?: string[]): string {
  const parts: string[] = [];
  const dir = join(projectDir(slug), "bible");

  const world = readIfExists(join(dir, "world.md"));
  if (world) parts.push("# World\n" + world);

  // Load individual character files — critical for writer/character consistency
  const charsDir = join(dir, "characters");
  if (existsSync(charsDir)) {
    const charFiles = readdirSync(charsDir)
      .filter((f) => f.endsWith(".md") && f !== "relationships.md");
    // If specific characters requested, filter; otherwise load all
    const toLoad = characters?.length
      ? charFiles.filter((f) => characters.some((c) => f.toLowerCase().includes(c.toLowerCase())))
      : charFiles;
    for (const f of toLoad) {
      const content = readIfExists(join(charsDir, f));
      if (content) parts.push(`# Character: ${f.replace(".md", "")}\n${content}`);
    }
  }

  const relationships = readIfExists(join(dir, "characters", "relationships.md"));
  if (relationships) parts.push("# Character Relationships\n" + relationships);

  return parts.join("\n\n");
}

function loadContinuityData(slug: string): string {
  const parts: string[] = [];
  const dir = join(projectDir(slug), "continuity");

  const facts = readIfExists(join(dir, "facts.json"));
  if (facts) {
    try {
      const parsed = JSON.parse(facts);
      parts.push("# Established Facts\n```json\n" + JSON.stringify(parsed, null, 2) + "\n```");
    } catch { parts.push("# Established Facts\n" + facts); }
  }

  const timeline = readIfExists(join(dir, "timeline.json"));
  if (timeline) {
    try {
      const parsed = JSON.parse(timeline);
      parts.push("# Story Timeline\n```json\n" + JSON.stringify(parsed, null, 2) + "\n```");
    } catch { parts.push("# Story Timeline\n" + timeline); }
  }

  const states = readIfExists(join(dir, "character-states.json"));
  if (states) {
    try {
      const parsed = JSON.parse(states);
      parts.push("# Character States\n```json\n" + JSON.stringify(parsed, null, 2) + "\n```");
    } catch { parts.push("# Character States\n" + states); }
  }

  return parts.join("\n\n");
}

function loadGlobalMemory(): string {
  const path = join(DATA_DIR, "global-memory.md");
  const content = readIfExists(path);
  return content ? "# Global Memory (Cross-Project Preferences)\n" + content : "";
}

function loadChapterSummaries(
  slug: string,
  fromCh: number,
  toCh: number
): string {
  const parts: string[] = [];
  const dir = join(projectDir(slug), "memory", "chapter-summaries");

  for (let i = fromCh; i <= toCh; i++) {
    const num = String(i).padStart(2, "0");
    const summary = readIfExists(join(dir, `ch${num}.md`));
    if (summary) parts.push(`## Chapter ${i}\n${summary}`);
  }

  return parts.join("\n\n");
}

export function loadSkills(role: RoleName, skillGroup?: string): string {
  // Determine which skill group to load
  const group = skillGroup || ROLE_DEFAULT_SKILLS[role] || "";
  if (!group) return "";

  const skillNames = SKILL_GROUPS[group] ?? [];
  if (skillNames.length === 0) return "";

  const skillsDir = join(AGENTS_DIR, "skills");
  const parts: string[] = [];

  for (const name of skillNames) {
    const path = join(skillsDir, `${name}.md`);
    const content = readIfExists(path);
    if (content) parts.push(content);
  }

  if (parts.length === 0) return "";
  return `# Writing Skills Reference (${group})\n\n` + parts.join("\n\n---\n\n");
}

// --- Draft progress tracking ---

/**
 * Scan draft/ directory to build a progress report for the agent.
 * Tells the agent which chapters/beats are done and how many chars each.
 */
function loadDraftProgress(slug: string): string {
  const dir = join(projectDir(slug), "draft");
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) return "";

  const sections = files.map((f) => {
    const content = readFileSync(join(dir, f), "utf-8");
    const id = f.replace(".md", "");
    return { id, charCount: content.length };
  });

  // Group by chapter (阳一, 阳二, 阴一, etc.)
  const chapters = new Map<string, { id: string; charCount: number }[]>();
  for (const s of sections) {
    const chapterName = s.id.includes(".") ? s.id.split(".")[0] : s.id;
    if (!chapters.has(chapterName)) chapters.set(chapterName, []);
    chapters.get(chapterName)!.push(s);
  }

  let progress = "# 写作进度\n\n";
  let totalChars = 0;
  for (const [chapter, beats] of chapters) {
    const beatStr = beats.map((b) => `✓ ${b.id} (${b.charCount}字)`).join("  ");
    const chapterTotal = beats.reduce((sum, b) => sum + b.charCount, 0);
    totalChars += chapterTotal;
    progress += `${beatStr}  — ${chapter} 共${chapterTotal}字\n`;
  }
  progress += `\n共 ${sections.length} 节，${totalChars} 字已完成。\n`;
  progress += `\n**重要：不要重写已完成的章节。根据用户指令继续写下一个章节/beat。**\n`;

  return progress;
}

/**
 * Load the most recent completed draft content
 * so the writer can maintain continuity with what came before.
 */
function loadRecentDraft(slug: string, maxChars = 3000): string {
  const dir = join(projectDir(slug), "draft");
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse(); // most recent first

  if (files.length === 0) return "";

  const parts: string[] = [];
  let totalChars = 0;
  for (const f of files) {
    if (totalChars >= maxChars) break;
    const content = readFileSync(join(dir, f), "utf-8");
    const id = f.replace(".md", "");
    parts.unshift(`### ${id}\n\n${content}`);
    totalChars += content.length;
  }

  if (parts.length === 0) return "";
  return "# 最近写完的内容（供衔接参考）\n\n" + parts.join("\n\n---\n\n");
}

function loadFramework(slug: string): string {
  const meta = loadMeta(slug);
  if (!meta) return "";

  const type = (meta as { type?: string }).type;
  if (!type) return "";

  const frameworkMap: Record<string, string> = {
    novel: "novel.md",
    screenplay: "novel.md", // use novel framework for now
  };

  const filename = frameworkMap[type];
  if (!filename) return "";

  const path = join(AGENTS_DIR, "frameworks", filename);
  const content = readIfExists(path);
  if (!content) return "";
  return "# Writing Framework\n\n" + content;
}

function loadMeta(slug: string): Record<string, unknown> | null {
  const raw = readIfExists(join(projectDir(slug), "meta", "project.json"));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Context builder ---

export interface ContextRequest {
  projectSlug: string;
  role: RoleName;
  task: string; // what this agent call is for
  chapter?: number; // if writing/reviewing a specific chapter
  phase?: string; // current creative phase
  extraContext?: string; // anything else to inject
  skillGroup?: string; // override default skill group (e.g. "revision", "dialogue")
  compact?: boolean; // use compressed phase summaries (for draft/review/final)
}

export function buildContext(req: ContextRequest): {
  system: string;
  messages: LLMMessage[];
} {
  const role = loadRole(req.role);
  const meta = loadMeta(req.projectSlug);

  // Build system prompt in priority order:
  // 1. Role identity (who I am)
  // 2. Global memory (cross-project user preferences)
  // 3. Project memory + style guide (project-specific rules)
  // 4. Agent's own notes
  // 5. Phase summaries (HARD CONSTRAINTS — locked decisions from prior phases)
  // 6. Skills + framework (craft reference — lowest priority, most generic)
  const systemParts: string[] = [role.systemPrompt];

  const globalMemory = loadGlobalMemory();
  if (globalMemory) systemParts.push(globalMemory);

  const projectMemory = loadProjectMemory(req.projectSlug);
  if (projectMemory) systemParts.push(projectMemory);

  const agentNotes = loadAgentNotes(req.projectSlug, req.role);
  if (agentNotes) systemParts.push("# My Notes\n" + agentNotes);

  // Load summaries from completed phases
  // In draft/review/final phases, use compact mode by default (only ✓ items)
  const useCompact = req.compact ?? ["draft", "review", "final"].includes(req.phase ?? "");
  const phaseSummaries = loadPhaseSummaries(req.projectSlug, req.phase, useCompact);
  if (phaseSummaries) systemParts.push(phaseSummaries);

  // Draft progress: tell the agent what's already been written
  if (req.phase === "draft" || req.phase === "review") {
    const draftProgress = loadDraftProgress(req.projectSlug);
    if (draftProgress) systemParts.push(draftProgress);
  }

  // Skills: load only the relevant group, not all skills for the role
  const skills = loadSkills(req.role, req.skillGroup);
  if (skills) systemParts.push(skills);

  const framework = loadFramework(req.projectSlug);
  if (framework) systemParts.push(framework);

  if (meta) {
    systemParts.push(
      `# Project Info\n${JSON.stringify(meta, null, 2)}`
    );
  }

  // Phase-aware coordination
  if (req.phase) {
    const PHASE_MAP: Record<string, { label: string; next?: string; nextLabel?: string; nextAgent?: string }> = {
      conception: { label: "构思", next: "bible", nextLabel: "世界与角色", nextAgent: "画皮（角色agent）" },
      bible: { label: "世界与角色", next: "structure", nextLabel: "结构", nextAgent: "鲁班（结构agent）" },
      structure: { label: "结构", next: "draft", nextLabel: "写作", nextAgent: "妙笔（写手agent）" },
      draft: { label: "写作", next: "review", nextLabel: "审稿", nextAgent: "铁面（编辑agent）" },
      review: { label: "审稿", next: "final", nextLabel: "定稿", nextAgent: "知音（读者agent）" },
      final: { label: "定稿" },
    };
    const phaseInfo = PHASE_MAP[req.phase];
    if (phaseInfo) {
      let phasePrompt = `# 当前阶段：${phaseInfo.label}\n\n`;
      phasePrompt += `你正在「${phaseInfo.label}」阶段工作。\n\n`;
      if (phaseInfo.next) {
        phasePrompt += `当你觉得当前阶段已经足够扎实，可以提醒创作者考虑进入「${phaseInfo.nextLabel}」阶段。\n`;
        phasePrompt += `但**不要**自动推进——阶段切换完全由创作者决定。不要过早建议推进。\n`;
      } else {
        phasePrompt += `这是最终阶段。完成后输出最终成果。\n`;
      }
      systemParts.push(phasePrompt);
    }
  }

  // Task-specific context
  const contextParts: string[] = [];

  if (req.chapter !== undefined) {
    // For chapter-related tasks, load bible (all character files) + nearby chapter summaries
    const bible = loadBibleSummary(req.projectSlug);
    if (bible) contextParts.push(bible);

    const startCh = Math.max(1, req.chapter - 3);
    const summaries = loadChapterSummaries(
      req.projectSlug,
      startCh,
      req.chapter - 1
    );
    if (summaries) contextParts.push("# Previous Chapters\n" + summaries);

    // Load the outline for this chapter
    const outlinePath = join(
      projectDir(req.projectSlug),
      "structure",
      "scenes",
      `ch${String(req.chapter).padStart(2, "0")}.md`
    );
    const outline = readIfExists(outlinePath);
    if (outline) contextParts.push("# Scene Card for This Chapter\n" + outline);
  }

  // Continuity agent always gets the full continuity data
  // Character/writer agents also get it for awareness
  if (req.role === "continuity" || req.role === "writer" || req.role === "character") {
    const continuity = loadContinuityData(req.projectSlug);
    if (continuity) contextParts.push(continuity);
  }

  // In draft phase, inject recent draft content for continuity
  if ((req.phase === "draft" || req.phase === "review") &&
      (req.role === "writer" || req.role === "editor" || req.role === "continuity")) {
    const recentDraft = loadRecentDraft(req.projectSlug);
    if (recentDraft) contextParts.push(recentDraft);
  }

  if (req.extraContext) contextParts.push(req.extraContext);

  const userMessage = contextParts.length > 0
    ? `${req.task}\n\n---\n\n${contextParts.join("\n\n---\n\n")}`
    : req.task;

  return {
    system: systemParts.join("\n\n---\n\n"),
    messages: [{ role: "user", content: userMessage }],
  };
}


// ---------------------------------------------------------------------------
// Writing-phase context: Spec + Ledger + style anchor + recent draft tail
// ---------------------------------------------------------------------------

export interface WritingContextRequest {
  projectSlug: string;
  role: RoleName;
  beatId: string;       // e.g. "阳三.1"
  beatInstruction: string; // what this beat should contain (from beat sheet)
  userNote?: string;     // optional user instruction ("对话太假", "节奏太慢")
  skillGroup?: string;
}

export function buildWritingContext(req: WritingContextRequest): {
  system: string;
  messages: LLMMessage[];
} {
  const role = loadRole(req.role);

  const systemParts: string[] = [role.systemPrompt];

  // 1. Spec document (single authoritative source)
  const specFile = readIfExists(join(projectDir(req.projectSlug), "spec.md"));
  if (specFile) {
    systemParts.push("# 写作规格书（硬约束）\n\n" + specFile);

    // Extract style anchor section if present
    const anchorMatch = specFile.match(/## 风格锚\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
    if (anchorMatch && anchorMatch[1].trim()) {
      systemParts.push(
        "# 风格锚（你的文字必须接近这个质感）\n\n" + anchorMatch[1].trim()
      );
    }
  }

  // 2. Continuity Ledger
  const { loadLedger, formatLedgerForPrompt } = require("@/lib/ledger");
  const ledger = loadLedger(req.projectSlug);
  const ledgerText = formatLedgerForPrompt(ledger);
  if (ledgerText) systemParts.push(ledgerText);

  // 3. Skills (role-appropriate)
  const skills = loadSkills(req.role, req.skillGroup);
  if (skills) systemParts.push(skills);

  // 4. Anti-AI checklist for writer
  if (req.role === "writer") {
    const antiAi = readIfExists(join(process.cwd(), "agents", "checklists", "anti-ai.md"));
    if (antiAi) systemParts.push(antiAi);
  }

  // Build user message with beat instruction + recent draft tail
  const messageParts: string[] = [];

  messageParts.push(`请写 beat: **${req.beatId}**\n\n## 节拍指令\n${req.beatInstruction}`);

  if (req.userNote) {
    messageParts.push(`## 创作者指令\n${req.userNote}`);
  }

  // Recent draft tail for voice continuity
  const recentDraft = loadRecentDraft(req.projectSlug, 1500);
  if (recentDraft) {
    messageParts.push(recentDraft);
  }

  messageParts.push("直接输出正文。不要加标题、自检报告、字数统计或任何说明文字。");

  return {
    system: systemParts.join("\n\n---\n\n"),
    messages: [{ role: "user", content: messageParts.join("\n\n---\n\n") }],
  };
}
