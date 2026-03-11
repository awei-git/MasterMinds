import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { loadRole, type RoleName } from "./roles";
import type { LLMMessage } from "../llm";

const DATA_DIR = join(process.cwd(), "data");
const AGENTS_DIR = join(process.cwd(), "agents");

// Which skills are relevant to each role
const ROLE_SKILLS: Record<string, string[]> = {
  writer: [
    "scene-level-tension",
    "dialogue-subtext",
    "pov-camera-discipline",
    "psychic-distance",
    "free-indirect-discourse",
    "sentence-rhythm",
    "telling-detail",
    "iceberg-principle",
    "strategic-withholding",
    "objective-correlative",
    "image-systems",
    "voice-consistency",
    "compression",
  ],
  editor: [
    "scene-level-tension",
    "dialogue-subtext",
    "pov-camera-discipline",
    "sentence-rhythm",
    "telling-detail",
    "iceberg-principle",
    "voice-consistency",
    "compression",
  ],
  idea: [
    "novum-extrapolation-chain",
    "conceptual-metaphor-as-structure",
    "defamiliarization",
    "character-desire-contradiction",
  ],
  architect: [
    "strategic-withholding",
    "earned-ending",
    "image-systems",
    "scene-level-tension",
  ],
  character: [
    "character-desire-contradiction",
    "dialogue-subtext",
    "free-indirect-discourse",
    "psychic-distance",
  ],
  reader: [
    "scene-level-tension",
  ],
  continuity: [],
  worldbuilder: [
    "novum-extrapolation-chain",
    "incluing",
    "defamiliarization",
    "conceptual-metaphor-as-structure",
  ],
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

function loadPhaseSummaries(slug: string, currentPhase?: string): string {
  const PHASE_ORDER = ["conception", "bible", "structure", "draft", "review", "final"];
  const dir = join(projectDir(slug), "phases");
  const parts: string[] = [];

  // Load all completed phase summaries (before current phase)
  const currentIdx = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : PHASE_ORDER.length;
  for (let i = 0; i < currentIdx; i++) {
    const phase = PHASE_ORDER[i];
    const content = readIfExists(join(dir, `${phase}.md`));
    if (content) parts.push(content);
  }

  if (parts.length === 0) return "";
  return "# Previous Phase Summaries\n\n" + parts.join("\n\n---\n\n");
}

function loadAgentNotes(slug: string, role: RoleName): string {
  const path = join(projectDir(slug), "memory", "agent-notes", `${role}.md`);
  return readIfExists(path) ?? "";
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

export function loadSkills(role: RoleName): string {
  const skillNames = ROLE_SKILLS[role] ?? [];
  if (skillNames.length === 0) return "";

  const skillsDir = join(AGENTS_DIR, "skills");
  const parts: string[] = [];

  for (const name of skillNames) {
    const path = join(skillsDir, `${name}.md`);
    const content = readIfExists(path);
    if (content) parts.push(content);
  }

  if (parts.length === 0) return "";
  return "# Writing Skills Reference\n\n" + parts.join("\n\n---\n\n");
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
}

export function buildContext(req: ContextRequest): {
  system: string;
  messages: LLMMessage[];
} {
  const role = loadRole(req.role);
  const meta = loadMeta(req.projectSlug);

  // Build system prompt in priority order:
  // 1. Role identity (who I am)
  // 2. Global memory (cross-project user preferences — override generic defaults)
  // 3. Project memory + style guide (project-specific rules — override skills)
  // 4. Agent's own notes (my accumulated knowledge on this project)
  // 5. Phase summaries (what happened before)
  // 6. Skills + framework (craft reference — lowest priority, most generic)
  const systemParts: string[] = [role.systemPrompt];

  const globalMemory = loadGlobalMemory();
  if (globalMemory) systemParts.push(globalMemory);

  const projectMemory = loadProjectMemory(req.projectSlug);
  if (projectMemory) systemParts.push(projectMemory);

  const agentNotes = loadAgentNotes(req.projectSlug, req.role);
  if (agentNotes) systemParts.push("# My Notes\n" + agentNotes);

  // Load summaries from completed phases
  const phaseSummaries = loadPhaseSummaries(req.projectSlug, req.phase);
  if (phaseSummaries) systemParts.push(phaseSummaries);

  // Skills and framework last — generic craft reference, overridden by project-specific above
  const skills = loadSkills(req.role);
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
        phasePrompt += `## 阶段推进规则\n`;
        phasePrompt += `当你判断当前阶段的核心工作已经完成（关键要素已锁定、没有重大遗漏），你应该：\n`;
        phasePrompt += `1. 做一个简短总结，列出当前阶段锁定的内容\n`;
        phasePrompt += `2. 在回复的**最后一行**，单独写：\`[PHASE_COMPLETE]\`\n`;
        phasePrompt += `3. 建议创作者进入下一阶段「${phaseInfo.nextLabel}」，由${phaseInfo.nextAgent}接手\n\n`;
        phasePrompt += `**重要**：不要过早推进。确保当前阶段足够扎实再建议进入下一步。也不要每次都提——只在真正完成时才说。\n`;
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

  if (req.extraContext) contextParts.push(req.extraContext);

  const userMessage = contextParts.length > 0
    ? `${req.task}\n\n---\n\n${contextParts.join("\n\n---\n\n")}`
    : req.task;

  return {
    system: systemParts.join("\n\n---\n\n"),
    messages: [{ role: "user", content: userMessage }],
  };
}
