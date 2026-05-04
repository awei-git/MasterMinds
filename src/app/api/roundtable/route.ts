import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { complete, type ModelProvider } from "@/lib/llm";
import { buildContext } from "@/lib/agents/context";
import type { RoleName } from "@/lib/agents/roles";
import {
  GROUNDED_ROUNDTABLE_PROTOCOL,
  ROUND_TABLE_PROTOCOL,
  discussionTopicForPhase,
  normalizePhase,
  phaseDefinition,
  roleAlias,
} from "@/lib/workflow";

interface RoundtableRequest {
  projectSlug: string;
  topic?: string;
  phase?: string;
  roles?: RoleName[];
  provider?: ModelProvider;
  discussionId?: string;
  humanInterjection?: string;
  maxRounds?: number;
  generateSummary?: boolean;
}

function transcriptForPrompt(items: Array<{ role: string; content: string }>): string {
  return items.map((item) => `【${roleAlias(item.role)}】\n${item.content}`).join("\n\n---\n\n");
}

function hasHardDisagreement(text: string): boolean {
  return /但是|不同意|反对|不成立|硬分歧|待裁决|裁决|我不赞成/.test(text);
}

function isDirectContextQuestion(topic: string): boolean {
  return /定了吗|确定了吗|是否|是不是|有没有|是什么|谁|哪里|何时|为什么|怎么|了吗|了吗？|\?$/.test(topic);
}

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  const discussionId = req.nextUrl.searchParams.get("discussionId");

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const where = discussionId
    ? { id: discussionId, projectId: project.id }
    : { projectId: project.id };
  const discussions = await prisma.discussion.findMany({
    where,
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });

  return Response.json(discussionId ? discussions[0] ?? null : discussions);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RoundtableRequest;
  const {
    projectSlug,
    provider = "claude-code",
    maxRounds = 2,
    generateSummary = false,
  } = body;

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const phase = normalizePhase(body.phase ?? project.phase);
  const phaseDef = phaseDefinition(phase);
  const topic = body.topic?.trim() || discussionTopicForPhase(phase);
  const roles = body.roles?.length ? body.roles : phaseDef.roundtableRoles;
  const directContextQuestion = isDirectContextQuestion(topic);
  const effectiveMaxRounds = directContextQuestion ? 1 : maxRounds;

  const discussion = body.discussionId
    ? await prisma.discussion.findFirst({ where: { id: body.discussionId, projectId: project.id } })
    : await prisma.discussion.create({
        data: {
          projectId: project.id,
          topic,
          phase,
          status: "open",
        },
      });

  if (!discussion) return Response.json({ error: "discussion not found" }, { status: 404 });

  if (body.humanInterjection?.trim()) {
    await prisma.message.create({
      data: {
        projectId: project.id,
        discussionId: discussion.id,
        role: "human",
        phase,
        content: body.humanInterjection.trim(),
      },
    });
  } else if (!body.discussionId && body.topic?.trim()) {
    await prisma.message.create({
      data: {
        projectId: project.id,
        discussionId: discussion.id,
        role: "human",
        phase,
        content: body.topic.trim(),
      },
    });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "roundtable_start", discussionId: discussion.id, phase, topic, roles });

        const conversation: Array<{ role: string; content: string }> = (
          await prisma.message.findMany({
            where: { discussionId: discussion.id },
            orderBy: { createdAt: "asc" },
          })
        ).map((m) => ({ role: m.role, content: m.content }));

        let disagreement = true;
        for (let round = 1; round <= effectiveMaxRounds && disagreement; round++) {
          disagreement = false;
          send({ type: "round_start", round });

          for (const role of roles) {
            const prior = transcriptForPrompt(conversation);
            const prompt = [
              `# 圆桌议题\n${topic}`,
              `# 阶段目标\n${phaseDef.goal}`,
              GROUNDED_ROUNDTABLE_PROTOCOL,
              prior ? `# 已有发言\n${prior}` : "",
              directContextQuestion
                ? "这是事实核对问题。先给结论，再列纪要里的具体依据；如果前面已经充分回答且你没有新增具体依据，输出 [PASS]。"
                : round === 1
                  ? "请按圆桌发言规则给出你的第一轮发言。必须落到当前项目的具体事实、角色、冲突或结构，不要讲创作理念。"
                  : "请只回应上一轮的分歧；如果没有新增具体依据或新增裁决项，输出 [PASS]。",
            ].filter(Boolean).join("\n\n---\n\n");

            const ctx = buildContext({
              projectSlug,
              role,
              task: prompt,
              phase,
              compact: false,
              includeCurrentPhase: true,
            });
            send({ type: "agent_start", role, label: roleAlias(role), round });

            const raw = await complete(provider, ctx.messages, {
              system: ctx.system,
              maxTokens: directContextQuestion ? 700 : 1400,
              temperature: directContextQuestion ? 0.2 : 0.45,
            }, req.signal);
            const content = raw.replace(/\n?\[PASS\]\n?/g, "").trim();
            const passed = raw.includes("[PASS]") || content.length === 0;

            if (!passed) {
              disagreement = disagreement || hasHardDisagreement(content);
              conversation.push({ role, content });
              const msg = await prisma.message.create({
                data: {
                  projectId: project.id,
                  discussionId: discussion.id,
                  role,
                  model: provider,
                  phase,
                  content,
                },
              });
              send({ type: "agent_done", role, label: roleAlias(role), round, message: msg });
            } else {
              send({ type: "agent_pass", role, label: roleAlias(role), round });
            }
          }

          send({ type: "round_done", round, hasDisagreement: disagreement });
        }

        if (generateSummary) {
          const summaryPrompt = [
            "# 史官纪要任务",
            "你不参与讨论，只归纳会议纪要。请输出用于创作者确认的结构化纪要：已确定、待裁决、独立写作任务、下一步。",
            ROUND_TABLE_PROTOCOL,
            `# 圆桌记录\n${transcriptForPrompt(conversation)}`,
          ].join("\n\n---\n\n");
          const ctx = buildContext({
            projectSlug,
            role: "chronicler",
            task: summaryPrompt,
            phase,
            compact: false,
            includeCurrentPhase: true,
          });
          send({ type: "chronicler_start", role: "chronicler", label: roleAlias("chronicler") });
          const summary = await complete(provider, ctx.messages, {
            system: ctx.system,
            maxTokens: 5000,
            temperature: 0.3,
          }, req.signal);
          const summaryMessage = await prisma.message.create({
            data: {
              projectId: project.id,
              discussionId: discussion.id,
              role: "chronicler",
              model: provider,
              phase,
              content: summary.trim(),
            },
          });
          await prisma.discussion.update({
            where: { id: discussion.id },
            data: { resolution: summary.trim(), status: "resolved", decidedBy: "chronicler" },
          });
          send({ type: "chronicler_done", message: summaryMessage });
        }

        send({ type: "done", discussionId: discussion.id });
      } catch (err) {
        console.error("roundtable error:", err);
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
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
