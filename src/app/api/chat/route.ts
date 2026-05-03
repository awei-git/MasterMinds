import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { stream, type ModelProvider } from "@/lib/llm";
import { buildContext, hasPhaseSummaries } from "@/lib/agents/context";
import type { RoleName } from "@/lib/agents/roles";
import { normalizePhase } from "@/lib/workflow";

/**
 * Multi-model routing: each model does what it's best at.
 *   GPT      — 写 (语感强，感官密度高，bake-off 48-50/50)
 *   Claude   — 评、改 (冷静克制，分析精准)
 *   DeepSeek — 出主意、灵感 (reasoner 发散思维)
 *   Gemini   — 整理、记录、查错 (快，长上下文)
 */
function routeProvider(role: RoleName, baseProvider: ModelProvider): ModelProvider {
  if (baseProvider !== "claude-code") return baseProvider;

  const ROLE_PROVIDER: Partial<Record<RoleName, ModelProvider>> = {
    writer: "gpt",              // 写：语感、感官密度
    character: "gpt",           // 角色塑造：也是创作
    idea: "deepseek",           // 灵感、构思：发散思维
    architect: "deepseek",      // 结构设计：推理能力
    editor: "claude-code",      // 审稿、改稿：冷静精准
    reviewer: "claude-code",    // 独立评审：冷静克制
    reader: "gemini",           // 评分：快速分析
    continuity: "gemini",       // 查错：长上下文
    chronicler: "gemini",       // 整理记录：总结能力
  };

  return ROLE_PROVIDER[role] ?? "gpt";
}

export async function GET(req: NextRequest) {
  try {
    const projectSlug = req.nextUrl.searchParams.get("projectSlug");
    const format = req.nextUrl.searchParams.get("format");
    if (!projectSlug) {
      return Response.json([]);
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json([]);
    }

    const messages = await prisma.message.findMany({
      where: { projectId: project.id, discussionId: null },
      orderBy: { createdAt: "asc" },
    });

    if (format === "md") {
      const roleLabels: Record<string, string> = {
        human: "你",
        idea: "💡 灵犀",
        architect: "🏗 鲁班",
        character: "🎭 画皮",
        writer: "✍ 妙笔",
        editor: "📝 铁面",
        reader: "📖 知音",
        continuity: "🔗 掌故",
      };
      const providerLabels: Record<string, string> = {
        claude: "Claude", gpt: "GPT", deepseek: "DeepSeek", gemini: "Gemini",
      };
      const lines: string[] = [`# ${project.title}\n`];
      const dateStr = new Date().toISOString().slice(0, 10);
      lines.push(`> 导出于 ${dateStr} · 共 ${messages.length} 条消息\n`);
      lines.push("---\n");

      for (const m of messages) {
        const label = roleLabels[m.role] ?? m.role;
        const model = m.model ? ` (${providerLabels[m.model] ?? m.model})` : "";
        const time = new Date(m.createdAt).toLocaleString("zh-CN", { hour12: false });
        lines.push(`### ${label}${model}`);
        lines.push(`<sub>${time}</sub>\n`);
        lines.push(m.content);
        lines.push("\n---\n");
      }

      const md = lines.join("\n");
      return new Response(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="chat-export.md"; filename*=UTF-8''${encodeURIComponent(project.title + "-对话记录.md")}`,
        },
      });
    }

    return Response.json(messages);
  } catch (err) {
    console.error("chat GET error:", err);
    return Response.json([], { status: 200 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const {
    projectSlug,
    role = "idea",
    message,
    provider = "claude-code",
    skipSaveHuman = false,
    skipSaveAgent = false,
    cleanContext = false,
    skillGroup,
  } = body as {
    projectSlug: string;
    role: RoleName;
    message: string;
    provider?: ModelProvider;
    skipSaveHuman?: boolean;
    skipSaveAgent?: boolean;
    cleanContext?: boolean; // revision mode: skip chat history, only send message as-is
    skillGroup?: string; // override skill group (e.g. "revision", "dialogue")
  };

  if (!projectSlug || !message) {
    return new Response(JSON.stringify({ error: "projectSlug and message required" }), {
      status: 400,
    });
  }

  // Save human message
  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "project not found" }), { status: 404 });
  }

  if (!skipSaveHuman) {
    await prisma.message.create({
      data: {
        projectId: project.id,
        role: "human",
        content: message,
        phase: normalizePhase(project.phase),
      },
    });
  }

  // Build agent context (includes system prompt, skills, project memory, bible, etc.)
  const ctx = buildContext({
    projectSlug,
    role,
    task: message,
    phase: normalizePhase(project.phase),
    skillGroup,
  });

  let llmMessages: { role: "user" | "assistant"; content: string }[];

  if (cleanContext) {
    // Clean revision mode: NO chat history. Only system prompt + the structured message.
    // The message already contains everything the agent needs (draft + revision checklist).
    llmMessages = [{ role: "user", content: ctx.messages[0]?.content ?? message }];
  } else {
    // Normal mode: load chat history
    const history = await prisma.message.findMany({
      where: { projectId: project.id, discussionId: null },
      orderBy: { createdAt: "asc" },
    });

    // When phase summaries exist, only send recent messages to LLM
    // (summaries in system prompt cover earlier context)
    const useFullHistory = !hasPhaseSummaries(projectSlug, normalizePhase(project.phase));
    const relevantHistory = useFullHistory ? history : history.slice(-40);

    // Convert history to LLM messages
    llmMessages = relevantHistory.map((m) => {
      if (m.role === "context") {
        const label = m.model && m.model !== "import" ? m.model : "导入的参考资料";
        return {
          role: "user" as const,
          content: `[${label}]\n\n${m.content}`,
        };
      }
      return {
        role: (m.role === "human" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      };
    });

    // Inject buildContext's extra context (bible, chapter summaries, etc.) into the first user message
    if (ctx.messages.length > 0 && ctx.messages[0].content !== message) {
      const lastUserIdx = llmMessages.findLastIndex((m) => m.role === "user");
      if (lastUserIdx >= 0) {
        llmMessages[lastUserIdx] = { role: "user", content: ctx.messages[0].content };
      }
    }

    // When skipSaveHuman=true (follow-up agents in roundtable), the message wasn't saved to DB
    // and may not be in llmMessages. Append it as the last user message so the LLM sees the instruction.
    if (skipSaveHuman) {
      llmMessages.push({ role: "user", content: ctx.messages[0]?.content ?? message });
    }
  }

  // Route to the best provider for this role
  const effectiveProvider = routeProvider(role, provider);

  // Enable extended thinking for creative/strategic roles; skip for utility roles
  const THINKING_ROLES = new Set(["writer", "architect", "editor", "character", "idea"]);
  const useThinking = effectiveProvider === "claude" && THINKING_ROLES.has(role);

  // Stream response
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";

      try {
        await stream(effectiveProvider, llmMessages, { system: ctx.system, thinking: useThinking }, {
          onText(text) {
            fullText += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          },
          async onDone() {
            // Save agent message (skip for intermediate draft loop rounds)
            if (!skipSaveAgent) {
              await prisma.message.create({
                data: {
                  projectId: project.id,
                  role,
                  model: effectiveProvider,
                  phase: normalizePhase(project.phase),
                  content: fullText,
                },
              });
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
          onError(error) {
            console.error("LLM stream error:", error);
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: error.message })}\n\n`
                )
              );
              controller.close();
            } catch { /* controller already closed */ }
          },
        }, req.signal);
      } catch (error) {
        console.error("Stream setup error:", error);
        const msg = error instanceof Error ? error.message : "Unknown error";
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
          );
          controller.close();
        } catch { /* controller already closed */ }
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

// PATCH — import markdown as context
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, content, source } = body as {
      projectSlug: string;
      content: string;
      source?: string; // filename or label
    };

    if (!projectSlug || !content) {
      return Response.json({ error: "projectSlug and content required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }

    const msg = await prisma.message.create({
      data: {
        projectId: project.id,
        role: "context",
        content,
        model: source ?? "import",
      },
    });

    return Response.json(msg);
  } catch (err) {
    console.error("chat PATCH error:", err);
    return Response.json({ error: "导入失败" }, { status: 500 });
  }
}

// PUT — save a standalone message (e.g. human note/comment)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { role, content } = body as { role: string; content: string };
    const projectSlug = req.nextUrl.searchParams.get("projectSlug");
    if (!projectSlug || !content) {
      return Response.json({ error: "projectSlug and content required" }, { status: 400 });
    }
    const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }
    const msg = await prisma.message.create({
      data: { projectId: project.id, role: role || "human", content },
    });
    return Response.json(msg);
  } catch (err) {
    console.error("chat PUT error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}

// DELETE — clear all messages for a project, or delete a single message
export async function DELETE(req: NextRequest) {
  try {
    const projectSlug = req.nextUrl.searchParams.get("projectSlug");
    const messageId = req.nextUrl.searchParams.get("messageId");

    if (messageId) {
      // Delete single message
      await prisma.message.delete({ where: { id: messageId } });
      return Response.json({ ok: true });
    }

    if (!projectSlug) {
      return Response.json({ error: "projectSlug required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }

    // Clear all non-discussion messages
    const { count } = await prisma.message.deleteMany({
      where: { projectId: project.id, discussionId: null },
    });

    return Response.json({ ok: true, deleted: count });
  } catch (err) {
    console.error("chat DELETE error:", err);
    return Response.json({ error: "删除失败" }, { status: 500 });
  }
}
