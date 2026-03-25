/**
 * Continuity Ledger — persistent cross-beat state tracking.
 *
 * Tracks motifs, naming conventions, character states, and established facts
 * across beats so the writer agent doesn't repeat images, break naming rules,
 * or contradict earlier content.
 *
 * Stored as data/{slug}/ledger.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { complete, type ModelProvider, MODEL_UTILITY } from "./llm";

const DATA_DIR = join(process.cwd(), "data");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Ledger {
  /** Recurring images/objects and where they appeared */
  motifs: Record<string, string[]>;
  /** Naming conventions per narrative line (e.g. 阳 vs 阴) */
  names_used: Record<string, Record<string, string>>;
  /** Current state of each character */
  character_states: Record<string, {
    location?: string;
    knows?: string[];
    mood?: string;
    [key: string]: unknown;
  }>;
  /** Established facts with source beat */
  facts: Array<{ fact: string; established_in: string }>;
  /** Which beats have been accepted */
  beats_completed: string[];
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function ledgerPath(slug: string): string {
  return join(DATA_DIR, slug, "ledger.json");
}

export function emptyLedger(): Ledger {
  return {
    motifs: {},
    names_used: {},
    character_states: {},
    facts: [],
    beats_completed: [],
  };
}

export function loadLedger(slug: string): Ledger {
  const path = ledgerPath(slug);
  if (!existsSync(path)) return emptyLedger();
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Ledger;
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(slug: string, ledger: Ledger): void {
  const dir = join(DATA_DIR, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerPath(slug), JSON.stringify(ledger, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Format for injection into writer system prompt
// ---------------------------------------------------------------------------

export function formatLedgerForPrompt(ledger: Ledger): string {
  const parts: string[] = ["# Continuity Ledger（硬约束）\n"];

  // Motifs
  if (Object.keys(ledger.motifs).length > 0) {
    parts.push("## 已使用的意象/物件（不要重复使用，除非有意回扣）");
    for (const [motif, beats] of Object.entries(ledger.motifs)) {
      parts.push(`- 「${motif}」→ 出现在 ${beats.join(", ")}`);
    }
    parts.push("");
  }

  // Naming
  if (Object.keys(ledger.names_used).length > 0) {
    parts.push("## 命名规则（严格执行）");
    for (const [line, names] of Object.entries(ledger.names_used)) {
      const entries = Object.entries(names).map(([real, alias]) => `${real}→「${alias}」`);
      parts.push(`- ${line}线：${entries.join("，")}`);
    }
    parts.push("");
  }

  // Character states
  if (Object.keys(ledger.character_states).length > 0) {
    parts.push("## 角色当前状态");
    for (const [char, state] of Object.entries(ledger.character_states)) {
      const details: string[] = [];
      if (state.location) details.push(`位置: ${state.location}`);
      if (state.mood) details.push(`状态: ${state.mood}`);
      if (state.knows?.length) details.push(`已知: ${state.knows.join(", ")}`);
      parts.push(`- **${char}**: ${details.join(" | ")}`);
    }
    parts.push("");
  }

  // Facts
  if (ledger.facts.length > 0) {
    parts.push("## 已建立的事实（不可矛盾）");
    for (const { fact, established_in } of ledger.facts) {
      parts.push(`- ${fact}（${established_in}）`);
    }
    parts.push("");
  }

  // Progress
  if (ledger.beats_completed.length > 0) {
    parts.push(`## 已完成 beats: ${ledger.beats_completed.join(", ")}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Auto-extract: after a beat is accepted, use a light LLM to update ledger
// ---------------------------------------------------------------------------

const EXTRACT_PROMPT = `你是一个连续性追踪员。请从刚完成的文本中提取以下信息，用于更新全局追踪表。

只提取**新出现的**内容，不要重复已有条目。

输出严格JSON格式（不要markdown围栏）：
{
  "new_motifs": ["意象/物件名称"],
  "new_names": {"真名": "文中使用的称呼"},
  "character_updates": {"角色名": {"location": "...", "mood": "...", "knows": ["新知道的事"]}},
  "new_facts": ["新建立的事实"]
}

只输出JSON，不要解释。如果某个类别没有新内容，用空数组/对象。`;

export async function extractAndUpdateLedger(
  slug: string,
  beatId: string,
  beatContent: string,
  provider: ModelProvider = "gemini",
): Promise<Ledger> {
  const ledger = loadLedger(slug);

  // Mark beat as completed
  if (!ledger.beats_completed.includes(beatId)) {
    ledger.beats_completed.push(beatId);
  }

  // Build context for extraction
  const existingContext = `已有追踪条目（不要重复）：
意象：${Object.keys(ledger.motifs).join("、") || "无"}
事实：${ledger.facts.map(f => f.fact).join("、") || "无"}`;

  try {
    const result = await complete(provider, [
      {
        role: "user",
        content: `${existingContext}\n\n---\n\nBeat ID: ${beatId}\n\n${beatContent}`,
      },
    ], {
      system: EXTRACT_PROMPT,
      temperature: 0.1,
      maxTokens: 2000,
      model: MODEL_UTILITY[provider],
    });

    if (!result) {
      saveLedger(slug, ledger);
      return ledger;
    }

    // Parse extraction result
    const m = result.match(/\{[\s\S]*\}/);
    if (!m) {
      saveLedger(slug, ledger);
      return ledger;
    }

    const extracted = JSON.parse(m[0]) as {
      new_motifs?: string[];
      new_names?: Record<string, string>;
      character_updates?: Record<string, Record<string, unknown>>;
      new_facts?: string[];
    };

    // Merge motifs
    if (extracted.new_motifs) {
      for (const motif of extracted.new_motifs) {
        if (!ledger.motifs[motif]) ledger.motifs[motif] = [];
        if (!ledger.motifs[motif].includes(beatId)) {
          ledger.motifs[motif].push(beatId);
        }
      }
    }

    // Merge names — detect line from beat ID (e.g. 阳一.1 → 阳, 阴一 → 阴)
    if (extracted.new_names) {
      const line = beatId.startsWith("阴") ? "阴" : "阳";
      if (!ledger.names_used[line]) ledger.names_used[line] = {};
      Object.assign(ledger.names_used[line], extracted.new_names);
    }

    // Merge character states (shallow merge per character)
    if (extracted.character_updates) {
      for (const [char, updates] of Object.entries(extracted.character_updates)) {
        const existing = ledger.character_states[char] || {};
        // Merge knows arrays
        if (Array.isArray(updates.knows) && Array.isArray(existing.knows)) {
          updates.knows = [...new Set([...existing.knows, ...updates.knows])];
        }
        ledger.character_states[char] = { ...existing, ...updates };
      }
    }

    // Merge facts
    if (extracted.new_facts) {
      for (const fact of extracted.new_facts) {
        // Avoid duplicates
        if (!ledger.facts.some(f => f.fact === fact)) {
          ledger.facts.push({ fact, established_in: beatId });
        }
      }
    }
  } catch (err) {
    console.error("Ledger extraction failed (saving partial):", err);
  }

  saveLedger(slug, ledger);
  return ledger;
}
