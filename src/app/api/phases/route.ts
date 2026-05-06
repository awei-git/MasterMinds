import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { complete, MODEL_UTILITY } from "@/lib/llm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { syncAppStatus } from "@/lib/status";
import { PHASE_LABELS, PHASE_ORDER, normalizePhase, phaseDefinition } from "@/lib/workflow";

const DATA_DIR = join(process.cwd(), "data");

function phasesDir(slug: string): string {
  return join(DATA_DIR, slug, "phases");
}

function summaryPath(slug: string, phase: string): string {
  return join(phasesDir(slug), `${phase}.md`);
}

// GET — read phase summary
export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  const phase = req.nextUrl.searchParams.get("phase");

  if (!projectSlug || !phase) {
    return Response.json({ error: "projectSlug and phase required" }, { status: 400 });
  }

  const path = summaryPath(projectSlug, normalizePhase(phase));
  if (!existsSync(path)) {
    return Response.json({ content: null });
  }

  const content = readFileSync(path, "utf-8");
  return Response.json({ content });
}

const ROLE_LABELS: Record<string, string> = {
  human: "创作者",
  idea: "灵犀（点子）",
  architect: "鲁班（结构）",
  character: "画皮（角色）",
  writer: "妙笔（写手）",
  editor: "铁面（编辑）",
  reader: "知音（读者）",
  continuity: "掌故（连续性）",
  chronicler: "史官（纪要）",
  context: "导入资料",
};

/**
 * Compact a message for summarization.
 * - Human messages: keep full (creator's words are sacred)
 * - Agent messages: truncate to ~800 chars, keep key decisions
 */
function compactMessage(role: string, content: string): string {
  if (role === "human" || role === "context") return content;
  // Agent messages: keep first 800 chars + signal if truncated
  if (content.length <= 800) return content;
  return content.slice(0, 800) + "\n\n[... 后续细节省略 ...]";
}

// POST — generate phase summary using LLM
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectSlug, phase: rawPhase } = body as {
      projectSlug: string;
      phase: string;
    };

    if (!projectSlug || !rawPhase) {
      return Response.json({ error: "projectSlug and phase required" }, { status: 400 });
    }
    const phase = normalizePhase(rawPhase);

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }

    // Filter messages by phase
    // Legacy messages (phase=NULL) belong to early phases (conception/bible/structure)
    const allMessages = await prisma.message.findMany({
      where: { projectId: project.id, discussionId: null },
      orderBy: { createdAt: "asc" },
    });

    let phaseMessages = allMessages.filter((m) => {
      if (phase === "conception") {
        return !m.phase || m.phase === "conception";
      }
      return m.phase === phase;
    });

    // Fallback: if no messages tagged for this phase, include untagged (legacy) messages
    // This handles projects where early phases weren't tagged in the DB
    if (phaseMessages.length === 0) {
      const untagged = allMessages.filter((m) => !m.phase);
      if (untagged.length > 0) {
        phaseMessages = untagged;
      }
    }

    if (phaseMessages.length === 0) {
      return Response.json({ error: "no messages for this phase" }, { status: 400 });
    }

    // Build compacted transcript (human = full, agent = truncated)
    const transcript = phaseMessages.map((m) => {
      const label = ROLE_LABELS[m.role] ?? m.role;
      const content = compactMessage(m.role, m.content);
      return `**${label}**:\n${content}`;
    }).join("\n\n---\n\n");

    // Include prior phase summaries as context (so LLM knows what's settled)
    const priorContext: string[] = [];
    const phaseIdx = PHASE_ORDER.indexOf(phase);
    if (phaseIdx > 0) {
      for (let i = 0; i < phaseIdx; i++) {
        const priorPhase = PHASE_ORDER[i];
        const priorPath = summaryPath(projectSlug, priorPhase);
        if (existsSync(priorPath)) {
          const priorContent = readFileSync(priorPath, "utf-8");
          if (priorContent.trim()) {
            priorContext.push(`## 前置：${PHASE_LABELS[priorPhase]}阶段总结（已确定）\n\n${priorContent}`);
          }
        }
      }
    }

    const phaseLabel = PHASE_LABELS[phase] ?? phase;
    const phaseDef = phaseDefinition(phase);

    const systemPrompt = `你是一个创意项目的记录员。你的任务是将一段多人讨论整理成一份详细、准确、结构化的阶段总结文档。

要求：
1. **完整性**：不遗漏任何重要决定、创意想法、或有价值的讨论点
2. **归属性**：标注每个观点来自谁（创作者还是哪个agent），尤其创作者的观点必须完整保留
3. **结构化**：用清晰的 markdown 结构组织，方便后续阶段的 agent 快速理解
4. **准确性**：不要添加讨论中没有的内容，不要臆测
5. **可操作性**：标注已确定的内容（✓）和待定/有争议的内容（?）
6. **去重**：被否决的方案只需简要记录"否决了X方案"，不要展开细节
7. **讨论/写作分离**：圆桌纪要只记录决策；独立写作任务成果单独归档，不要把散文正文混进会议纪要
8. **阶段目标**：${phaseDef.goal}

输出格式：
# ${phaseLabel}阶段总结

## 已确定的内容
（列出所有已锁定的决定）

## 创作者的核心观点
（完整保留创作者表达的想法、偏好、方向）

## 讨论要点
（按主题整理讨论内容，标注来源）

## 待定事项
（有分歧或尚未决定的问题）

## 下一阶段需要关注的
（对后续工作的建议）

## 独立写作任务
（本阶段需要执行或已经执行的写作任务、产物路径、是否等待创作者确认）`;

    const priorStr = priorContext.length > 0
      ? `\n\n---\n以下是前置阶段的总结，供参考（已确定的内容不需重复）：\n\n${priorContext.join("\n\n")}`
      : "";

    const result = await complete("deepseek", [
      { role: "user", content: `以下是「${project.title}」项目「${phaseLabel}」阶段的讨论记录（${phaseMessages.length}条消息）。请整理成阶段总结文档。${priorStr}\n\n---\n\n${transcript}` },
    ], { system: systemPrompt, model: MODEL_UTILITY.deepseek, maxTokens: 8192 });

    if (!result || !result.trim()) {
      return Response.json({ error: "LLM returned empty summary" }, { status: 500 });
    }

    // Save to filesystem
    const dir = phasesDir(projectSlug);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(summaryPath(projectSlug, phase), result, "utf-8");

    // Sync status to Mira
    syncAppStatus().catch(() => {});

    return Response.json({ content: result });
  } catch (err) {
    console.error("phase summary error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "生成总结失败" },
      { status: 500 }
    );
  }
}

// PATCH — manually edit phase summary
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, phase: rawPhase, content } = body as {
      projectSlug: string;
      phase: string;
      content: string;
    };

    if (!projectSlug || !rawPhase || content === undefined) {
      return Response.json({ error: "projectSlug, phase, and content required" }, { status: 400 });
    }
    const phase = normalizePhase(rawPhase);

    const dir = phasesDir(projectSlug);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(summaryPath(projectSlug, phase), content, "utf-8");

    syncAppStatus().catch(() => {});

    return Response.json({ ok: true });
  } catch (err) {
    console.error("phase save error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}
