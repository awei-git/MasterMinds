import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { stream, complete, type ModelProvider } from "@/lib/llm";
import { loadSkills } from "@/lib/agents/context";
import { loadRole } from "@/lib/agents/roles";

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const AGENTS_DIR = join(process.cwd(), "agents");

function readIfExists(path: string): string | null {
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return null;
}

function buildSystem(role: "idea" | "architect" | "writer" | "editor" | "reader"): string {
  const parts: string[] = [loadRole(role).systemPrompt];
  const skills = loadSkills(role);
  if (skills) parts.push(skills);

  if (role === "writer") {
    const antiAi = readIfExists(join(AGENTS_DIR, "checklists", "anti-ai.md"));
    if (antiAi) parts.push(antiAi);
    const styleTc = readIfExists(join(AGENTS_DIR, "frameworks", "style-ted-chiang.md"));
    if (styleTc) parts.push(styleTc);
  }
  if (role === "editor") {
    const selfEdit = readIfExists(join(AGENTS_DIR, "checklists", "self-edit.md"));
    if (selfEdit) parts.push(selfEdit);
    const antiAi = readIfExists(join(AGENTS_DIR, "checklists", "anti-ai.md"));
    if (antiAi) parts.push(antiAi);
    const feedbackLoop = readIfExists(join(AGENTS_DIR, "frameworks", "feedback-loop.md"));
    if (feedbackLoop) parts.push(feedbackLoop);
  }
  if (role === "reader") {
    const anchors = readIfExists(join(AGENTS_DIR, "frameworks", "scoring-anchors.md"));
    if (anchors) parts.push(anchors);
  }
  if (role === "idea" || role === "architect") {
    const essay = readIfExists(join(AGENTS_DIR, "frameworks", "essay.md"));
    if (essay) parts.push(essay);
    const novel = readIfExists(join(AGENTS_DIR, "frameworks", "novel.md"));
    if (novel) parts.push(novel);
  }

  return parts.join("\n\n---\n\n");
}

async function runStream(
  provider: ModelProvider,
  system: string,
  userMsg: string,
  send: (data: object) => void,
  agentKey: string,
  useThinking: boolean = false,
): Promise<string> {
  let output = "";
  await stream(
    provider,
    [{ role: "user", content: userMsg }],
    { system, thinking: useThinking && provider === "claude" },
    {
      onText: (t) => {
        output += t;
        send({ agent: agentKey, text: t, stage: "text" });
      },
      onDone: () => send({ agent: agentKey, text: "", stage: "done" }),
      onError: (e) => send({ agent: agentKey, error: e.message, stage: "error" }),
    }
  );
  return output;
}

// Extract pure prose from writer output (strip 自检报告, 采纳清单, etc.)
function extractProse(raw: string): string {
  let text = raw;

  // 1. Strip trailing non-prose sections (自检报告, 字数统计, etc.)
  const tailMarkers = [
    /\n---\s*\n\s*#{1,3}\s*自检报告[\s\S]*/,
    /\n---\s*\n\s*#{1,3}\s*审稿意见采纳清单[\s\S]*/,
    /\n#{1,3}\s*自检报告[\s\S]*/,
    /\n#{1,3}\s*审稿意见采纳清单[\s\S]*/,
    /\n字数统计[：:][^\n]*[\s\S]*/,
  ];
  for (const marker of tailMarkers) {
    text = text.replace(marker, "");
  }

  // 2. Strip leading 采纳清单 table if present (writer sometimes prepends it before prose)
  //    Handles #/##/### headings or bold markers, followed by a --- separator
  const adoptionHeader = text.match(/^\s*(#{1,3}\s*(?:采纳清单|审稿意见采纳[^\n]*)[\s\S]*?\n---\s*\n)/);
  if (adoptionHeader) {
    text = text.slice(adoptionHeader[0].length);
  }

  return text.trim();
}

function editorPassed(editOutput: string): boolean {
  const last300 = editOutput.slice(-300);
  // Match whole-word PASS (not PASSIVE/PASSED/COMPASS) or Chinese 无P0
  return /\bPASS\b/i.test(last300) || /无\s*P0/i.test(last300);
}

// Parse chapter plan from architect's JSON output
interface ChapterPlan {
  title: string;
  beats: string;
}

function parseChapterPlan(raw: string): ChapterPlan[] | null {
  // Find the last JSON array in the output (skip stray brackets in prose)
  const allArrays = [...raw.matchAll(/\[[\s\S]*?\]/g)];
  for (let i = allArrays.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(allArrays[i][0]);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        return parsed.length > 1 ? (parsed as ChapterPlan[]) : null;
      }
    } catch { /* not valid JSON, try next */ }
  }
  // Fallback: try greedy match for deeply nested JSON
  const greedy = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (greedy) {
    try {
      const parsed = JSON.parse(greedy[0]);
      if (Array.isArray(parsed) && parsed.length > 1 && parsed[0].title) {
        return parsed as ChapterPlan[];
      }
    } catch { /* not valid JSON */ }
  }
  return null;
}

// Generate a brief summary of a chapter for context passing
async function summarizeChapter(
  provider: ModelProvider,
  chapterText: string,
  chapterTitle: string,
): Promise<string> {
  return complete(provider, [
    {
      role: "user",
      content: `用100-150字概括以下章节的核心内容（人物、事件、情感变化、关键细节），供写下一章时参考。不要评价，只叙述发生了什么。

## ${chapterTitle}

${chapterText}`,
    },
  ], { temperature: 0.3 });
}

// Run edit→revise loop for a single piece of text, return final prose
async function editReviseLoop(
  provider: ModelProvider,
  systems: { writer: string; editor: string },
  draft: string,
  maxRounds: number,
  send: (data: object) => void,
  useThinking: boolean,
  chapterLabel: string,
  reflections: string[],
): Promise<string> {
  let currentDraft = draft;
  let converged = false;
  const prefix = chapterLabel ? `${chapterLabel} ` : "";

  for (let round = 1; round <= maxRounds; round++) {
    send({ agent: "edit", label: `铁面 · ${prefix}第${round}轮审稿`, stage: "start", round });
    const editOutput = await runStream(
      provider, systems.editor,
      `请审阅以下稿子（第${round}轮）：\n\n${currentDraft}`,
      send, "edit", useThinking
    );

    if (editorPassed(editOutput)) {
      send({ agent: "edit", stage: "passed", round });
      converged = true;

      send({ agent: "reflect", label: `铁面 · ${prefix}反思`, stage: "start", round });
      const reflection = await runStream(
        provider, systems.editor,
        `稿件已PASS。请输出简短反思（不超过150字）：
1. 反复出现的问题（1-3条）
2. 有效的改进（1-3条）
3. 下次写作注意（1-3条，具体可执行）

审稿意见：\n${editOutput}`,
        send, "reflect"
      );
      reflections.push(reflection);
      break;
    }

    const reflectionContext = reflections.length > 0
      ? `\n\n---\n\n## 往期修稿反思（避免重复犯错）\n\n${reflections.slice(-3).join("\n\n---\n\n")}`
      : "";

    send({ agent: "revise", label: `妙笔 · ${prefix}第${round}轮修改`, stage: "start", round });
    const rawRevise = await runStream(
      provider, systems.writer,
      `请根据以下审稿意见修改稿件。

⚠️ 改稿铁律：
1. 【守住清单】里的内容一字不动
2. 只改铁面明确指出的问题，不要动其他地方
3. 修改方向是写得更好，不是写得更短更安全
4. 禁止把长句拆成碎片短句，禁止删掉具体意象换成概括
5. 改完的稿件不应比原稿短超过10%

⚠️ 输出格式：先输出采纳清单（简短），然后用 --- 分隔，再输出修改后的完整正文。

---

## 原稿

${currentDraft}

---

## 审稿意见（第${round}轮）

${editOutput}${reflectionContext}`,
      send, "revise", useThinking
    );
    const cleaned = extractProse(rawRevise);
    // Only replace if extraction produced substantial text; otherwise keep current draft
    if (cleaned.length > currentDraft.length * 0.3) {
      currentDraft = cleaned;
    }

    send({ agent: "reflect", label: `铁面 · ${prefix}第${round}轮反思`, stage: "start", round });
    const reflection = await runStream(
      provider, systems.editor,
      `第${round}轮审稿修改完成。请输出简短反思（不超过150字）：
1. 反复出现的问题（1-3条）
2. 有效的改进（1-3条）
3. 下次写作注意（1-3条，具体可执行）

审稿意见：\n${editOutput}`,
      send, "reflect"
    );
    reflections.push(reflection);
  }

  if (!converged && currentDraft.length > 100) {
    send({ agent: "revise", label: `妙笔 · ${prefix}最终清稿`, stage: "start" });
    const rawFinal = await runStream(
      provider, systems.writer,
      `以下是经过多轮修改的稿件。请做最后一轮打磨，输出最终版本。

⚠️ 只输出纯正文，不要附带任何自检报告、采纳清单、字数统计。

${currentDraft}`,
      send, "revise", useThinking
    );
    const cleaned = extractProse(rawFinal);
    // Only use cleaned version if it's substantial; otherwise keep current draft
    if (cleaned.length > currentDraft.length * 0.5) {
      currentDraft = cleaned;
    }
  }

  return currentDraft;
}

export async function POST(req: NextRequest) {
  const { material, provider = "claude-code", maxRounds = 2 } = (await req.json()) as {
    material: string;
    provider?: ModelProvider;
    maxRounds?: number;
  };

  if (!material?.trim()) {
    return Response.json({ error: "material required" }, { status: 400 });
  }

  const systems = {
    idea: buildSystem("idea"),
    architect: buildSystem("architect"),
    writer: buildSystem("writer"),
    editor: buildSystem("editor"),
    reader: buildSystem("reader"),
  };

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(sseEvent(data)));

      try {
        const useThinking = provider === "claude";

        // ── Stage 1: Angle (灵犀) ──────────────────────────────
        send({ agent: "angle", label: "灵犀 · 找角度", stage: "start" });
        const angleOutput = await runStream(
          provider, systems.idea,
          `分析以下原始材料，找到最佳写作角度：\n\n${material}`,
          send, "angle", useThinking
        );

        // ── Stage 2: Structure (鲁班) ──────────────────────────
        send({ agent: "structure", label: "鲁班 · 定结构", stage: "start" });
        const structureOutput = await runStream(
          provider, systems.architect,
          `原始材料：\n${material}\n\n---\n\n角度分析：\n${angleOutput}\n\n---\n\n请制作文章结构。`,
          send, "structure", useThinking
        );

        // ── Stage 2.5: Detect chapters ─────────────────────────
        send({ agent: "structure", label: "鲁班 · 章节规划", stage: "start" });
        const planRaw = await runStream(
          provider, systems.architect,
          `根据你刚才制作的结构，判断这是单篇文章还是多章小说。

如果是**单篇文章/散文/博客**，输出：
[{"title":"全文","beats":"完整文章"}]

如果是**多章小说/中篇**，输出每章的JSON数组，例如：
[{"title":"一｜慢信邮局","beats":"开场，建立悬念..."},{"title":"二｜青梅时节","beats":"..."}]

只输出JSON数组，不要其他内容。

---

结构：
${structureOutput}`,
          send, "structure", false
        );

        const chapters = parseChapterPlan(planRaw);
        const isMultiChapter = chapters !== null && chapters.length > 1;

        let fullText: string;

        if (!isMultiChapter) {
          // ══════════════════════════════════════════════════════
          // SINGLE PIECE
          // ══════════════════════════════════════════════════════
          send({ agent: "draft", label: "妙笔 · 写初稿", stage: "start" });
          const rawDraft = await runStream(
            provider, systems.writer,
            `原始材料：\n${material}\n\n---\n\n角度：\n${angleOutput}\n\n---\n\n结构：\n${structureOutput}\n\n---\n\n按以上结构写完整篇文章。注意段落呼吸——段落长度要有高低起伏，不要每段差不多长。`,
            send, "draft", useThinking
          );
          const draft = extractProse(rawDraft) || rawDraft.trim();

          const reflections: string[] = [];
          fullText = await editReviseLoop(
            provider, systems, draft, maxRounds, send, useThinking, "", reflections
          );
        } else {
          // ══════════════════════════════════════════════════════
          // MULTI-CHAPTER
          // ══════════════════════════════════════════════════════
          const chapterTexts: string[] = [];
          const chapterSummaries: string[] = [];
          const reflections: string[] = []; // shared across chapters

          for (let ci = 0; ci < chapters.length; ci++) {
            const ch = chapters[ci];
            const chLabel = `Ch.${ci + 1}`;

            // Build context from previous chapters
            let prevContext = "";
            if (chapterSummaries.length > 0) {
              prevContext = "\n\n---\n\n## 前序章节摘要（硬约束：不可矛盾）\n\n";
              prevContext += chapterSummaries.map((s, i) =>
                `### ${chapters[i].title}\n${s}`
              ).join("\n\n");
              // Include last chapter's ending for voice continuity
              if (chapterTexts.length > 0) {
                const lastCh = chapterTexts[chapterTexts.length - 1];
                const tail = lastCh.length < 3000 ? lastCh : `…${lastCh.slice(-2000)}`;
                prevContext += `\n\n---\n\n## 上一章${lastCh.length < 3000 ? "全文" : "结尾"}（保持语感连贯）\n\n${tail}`;
              }
            }

            const reflectionHint = reflections.length > 0
              ? `\n\n---\n\n## 往期修稿反思（避免重复犯错）\n\n${reflections.slice(-3).join("\n\n---\n\n")}`
              : "";

            // ── Draft this chapter ──
            send({ agent: "draft", label: `妙笔 · ${chLabel} ${ch.title}`, stage: "start" });
            const rawDraft = await runStream(
              provider, systems.writer,
              `请写第${ci + 1}章：${ch.title}

## 章节要求
${ch.beats}

## 全文结构（供参考，只写当前这一章）
${structureOutput}

## 原始材料
${material}${prevContext}${reflectionHint}

---

只写这一章的正文。注意段落呼吸。`,
              send, "draft", useThinking
            );
            let chDraft = extractProse(rawDraft) || rawDraft.trim();

            // ── Edit-revise loop ──
            chDraft = await editReviseLoop(
              provider, systems, chDraft, maxRounds, send, useThinking, chLabel, reflections
            );

            chapterTexts.push(chDraft);

            // ── Summarize for next chapter ──
            if (ci < chapters.length - 1) {
              const summary = await summarizeChapter(provider, chDraft, ch.title);
              chapterSummaries.push(summary);
              send({ agent: "structure", label: `鲁班 · ${chLabel} 摘要`, stage: "start" });
              send({ agent: "structure", text: summary, stage: "text" });
              send({ agent: "structure", text: "", stage: "done" });
            }
          }

          fullText = chapterTexts.join("\n\n---\n\n");
        }

        // ── Reader evaluation on FULL text ─────────────────────
        send({ agent: "reader", label: "知音 · 全文评估", stage: "start" });
        await runStream(
          provider, systems.reader,
          `请作为第一读者阅读以下完整作品（${isMultiChapter ? chapters!.length + "章" : "单篇"}），输出阅读报告和评分。

评的是全文整体，不是单章。

${fullText}`,
          send, "reader"
        );

        send({ done: true, result: fullText });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "pipeline failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
