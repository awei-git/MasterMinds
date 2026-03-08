import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { complete, type ModelProvider } from "@/lib/llm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { syncAppStatus } from "@/lib/status";

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

  const path = summaryPath(projectSlug, phase);
  if (!existsSync(path)) {
    return Response.json({ content: null });
  }

  const content = readFileSync(path, "utf-8");
  return Response.json({ content });
}

// POST — generate phase summary using LLM
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectSlug, phase, provider = "gpt" } = body as {
      projectSlug: string;
      phase: string;
      provider?: ModelProvider;
    };

    if (!projectSlug || !phase) {
      return Response.json({ error: "projectSlug and phase required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }

    // Load all messages for this project
    const messages = await prisma.message.findMany({
      where: { projectId: project.id, discussionId: null },
      orderBy: { createdAt: "asc" },
    });

    if (messages.length === 0) {
      return Response.json({ error: "no messages to summarize" }, { status: 400 });
    }

    // Role labels for readable transcript
    const roleLabels: Record<string, string> = {
      human: "创作者",
      idea: "灵犀（点子）",
      architect: "鲁班（结构）",
      character: "画皮（角色）",
      writer: "妙笔（写手）",
      editor: "铁面（编辑）",
      reader: "知音（读者）",
      continuity: "掌故（连续性）",
      context: "导入资料",
    };

    const PHASE_LABELS: Record<string, string> = {
      conception: "构思",
      bible: "世界与角色",
      structure: "结构",
      draft: "写作",
      review: "审稿",
      final: "定稿",
    };

    // Build transcript
    const transcript = messages.map((m) => {
      const label = roleLabels[m.role] ?? m.role;
      return `**${label}**:\n${m.content}`;
    }).join("\n\n---\n\n");

    const phaseLabel = PHASE_LABELS[phase] ?? phase;

    const systemPrompt = `你是一个创意项目的记录员。你的任务是将一段多人讨论整理成一份详细、准确、结构化的阶段总结文档。

要求：
1. **完整性**：不遗漏任何重要决定、创意想法、或有价值的讨论点
2. **归属性**：标注每个观点来自谁（创作者还是哪个agent），尤其创作者的观点必须完整保留
3. **结构化**：用清晰的 markdown 结构组织，方便后续阶段的 agent 快速理解
4. **准确性**：不要添加讨论中没有的内容，不要臆测
5. **可操作性**：标注已确定的内容（✓）和待定/有争议的内容（?）

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
（对后续工作的建议）`;

    const result = await complete(provider, [
      { role: "user", content: `以下是「${project.title}」项目「${phaseLabel}」阶段的完整讨论记录。请整理成阶段总结文档。\n\n${transcript}` },
    ], { system: systemPrompt, maxTokens: 8192 });

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
    const { projectSlug, phase, content } = body as {
      projectSlug: string;
      phase: string;
      content: string;
    };

    if (!projectSlug || !phase || content === undefined) {
      return Response.json({ error: "projectSlug, phase, and content required" }, { status: 400 });
    }

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
