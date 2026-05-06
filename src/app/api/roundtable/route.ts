import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { complete, type ModelProvider } from "@/lib/llm";
import { buildContext } from "@/lib/agents/context";
import type { RoleName } from "@/lib/agents/roles";
import { routeProviderForRole, type ProviderSettings, type WritingLanguage } from "@/lib/model-routing";
import {
  buildRoundtableContextSummary,
  compactMessagesForTransport,
  compactTranscriptForPrompt,
  transcriptForPrompt,
  type RoundtableDigestDiscussion,
} from "@/lib/roundtable-compression";
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
  providerSettings?: ProviderSettings;
  writingLanguage?: WritingLanguage;
}

function hasHardDisagreement(text: string): boolean {
  return /但是|不同意|反对|不成立|硬分歧|待裁决|裁决|我不赞成/.test(text);
}

function isDirectContextQuestion(topic: string): boolean {
  return /定了吗|确定了吗|是否|是不是|有没有|是什么|谁|哪里|何时|为什么|怎么|了吗|了吗？|\?$/.test(topic);
}

function sanitizeRoundtableOutput(text: string): string {
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();

  const finalMarkers = [
    "Final Answer:",
    "Final:",
    "Answer:",
    "最终回答：",
    "回答：",
  ];
  for (const marker of finalMarkers) {
    const index = cleaned.lastIndexOf(marker);
    if (index >= 0) {
      cleaned = cleaned.slice(index + marker.length).trim();
      break;
    }
  }

  if (/^(Thinking Process|Reasoning|思考过程|推理过程)\s*[:：]/i.test(cleaned)) {
    return "";
  }

  return cleaned.replace(/\n?\[PASS\]\n?/g, "").trim();
}

function timeoutSignal(parent: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`model timed out after ${Math.round(ms / 1000)}s`)), ms);
  const onAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    parent.removeEventListener("abort", onAbort);
  }, { once: true });
  return controller.signal;
}

async function completeWithTimedFallback(
  primaryProvider: ModelProvider,
  messages: Parameters<typeof complete>[1],
  options: Parameters<typeof complete>[2],
  signal: AbortSignal,
  timeoutMs: number,
  onAttempt: (provider: ModelProvider, attempt: number) => void,
  onFailure: (provider: ModelProvider, error: string, attempt: number) => void,
): Promise<{ provider: ModelProvider; text: string }> {
  const providers: ModelProvider[] = ([primaryProvider, "gpt", "local"] as ModelProvider[])
    .filter((value, index, array) => array.indexOf(value) === index);

  let lastError = "model failed";
  for (const [index, provider] of providers.entries()) {
    onAttempt(provider, index + 1);
    try {
      const text = await complete(provider, messages, {
        ...options,
        fallback: false,
      }, timeoutSignal(signal, timeoutMs));
      const sanitized = sanitizeRoundtableOutput(text);
      if (!sanitized && text.trim()) {
        throw new Error("model returned hidden reasoning without a usable answer");
      }
      return { provider, text: sanitized };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      onFailure(provider, lastError, index + 1);
    }
  }
  throw new Error(lastError);
}

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  const discussionId = req.nextUrl.searchParams.get("discussionId");
  const phaseParam = req.nextUrl.searchParams.get("phase");
  const compact = req.nextUrl.searchParams.get("compact") === "1";

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const phase = phaseParam ? normalizePhase(phaseParam) : undefined;
  const where = discussionId
    ? { id: discussionId, projectId: project.id }
    : phase
      ? { projectId: project.id, phase }
      : { projectId: project.id };
  const discussions = await prisma.discussion.findMany({
    where,
    include: { messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });
  const response = discussions.map((discussion) => {
    const digestDiscussion: RoundtableDigestDiscussion = {
      id: discussion.id,
      topic: discussion.topic,
      phase: discussion.phase,
      status: discussion.status,
      resolution: discussion.resolution,
      messages: discussion.messages,
    };
    return {
      ...discussion,
      contextSummary: buildRoundtableContextSummary(digestDiscussion),
      messages: compact ? compactMessagesForTransport(digestDiscussion) : discussion.messages,
    };
  });

  return Response.json(discussionId ? response[0] ?? null : response);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RoundtableRequest;
  const {
    projectSlug,
    provider = "claude-code",
    maxRounds = 2,
    generateSummary = false,
    providerSettings,
    writingLanguage = "zh",
  } = body;

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) return Response.json({ error: "project not found" }, { status: 404 });

  const phase = normalizePhase(body.phase ?? project.phase);
  const phaseDef = phaseDefinition(phase);
  const topic = body.topic?.trim() || discussionTopicForPhase(phase);
  const currentQuestion = body.humanInterjection?.trim() || topic;
  const roles = body.roles?.length ? body.roles : phaseDef.roundtableRoles;
  const directContextQuestion = isDirectContextQuestion(currentQuestion);
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

  let savedHumanMessage: Awaited<ReturnType<typeof prisma.message.create>> | null = null;
  if (body.humanInterjection?.trim()) {
    savedHumanMessage = await prisma.message.create({
      data: {
        projectId: project.id,
        discussionId: discussion.id,
        role: "human",
        phase,
        content: body.humanInterjection.trim(),
      },
    });
  } else if (!body.discussionId && body.topic?.trim()) {
    savedHumanMessage = await prisma.message.create({
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
      let closed = false;
      const send = (data: object) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          closed = true;
          if (activeHeartbeat) {
            clearInterval(activeHeartbeat);
            activeHeartbeat = null;
          }
          return false;
        }
      };
      let activeHeartbeat: ReturnType<typeof setInterval> | null = null;

      try {
        send({ type: "roundtable_start", discussionId: discussion.id, phase, topic, roles });
        if (savedHumanMessage) {
          send({ type: "human_done", role: "human", label: roleAlias("human"), message: savedHumanMessage });
        }

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
            const prior = compactTranscriptForPrompt({
              topic,
              phase,
              status: discussion.status,
              resolution: discussion.resolution,
              messages: conversation,
            });
            const prompt = [
              `# 圆桌议题\n${topic}`,
              body.humanInterjection?.trim() ? `# 本次用户追问\n${body.humanInterjection.trim()}` : "",
              `# 阶段目标\n${phaseDef.goal}`,
              GROUNDED_ROUNDTABLE_PROTOCOL,
              prior ? `# 已有发言\n${prior}` : "",
              directContextQuestion
                ? "这是创作者的直接问题。每位成员都必须优先回答“本次用户追问”：先给一句人话结论，再给最多 3 条具体理由或落地建议；如果前面已回答，你也要补充验证、风险或缺口。禁止输出思考过程。只有纪要里完全没有与你职责相关的依据时，才输出 [PASS]。"
                : round === 1
                  ? "请按圆桌发言规则给出你的第一轮发言。必须落到当前项目的具体事实、角色、冲突或结构，不要讲创作理念，禁止输出思考过程。"
                  : "请只回应上一轮的分歧；如果没有新增具体依据或新增裁决项，输出 [PASS]，禁止输出思考过程。",
            ].filter(Boolean).join("\n\n---\n\n");

            const effectiveProvider = routeProviderForRole(role, provider, providerSettings, writingLanguage);
            const ctx = buildContext({
              projectSlug,
              role,
              task: prompt,
              phase,
              compact: false,
              includeCurrentPhase: true,
            });
            send({ type: "agent_start", role, label: roleAlias(role), round, provider: effectiveProvider });

            activeHeartbeat = setInterval(() => {
              send({ type: "heartbeat", role, label: roleAlias(role), round, provider: effectiveProvider });
            }, 15_000);

            let raw = "";
            let usedProvider = effectiveProvider;
            try {
              const result = await completeWithTimedFallback(
                effectiveProvider,
                ctx.messages,
                {
                  system: ctx.system,
                  maxTokens: directContextQuestion ? 700 : 1400,
                  temperature: directContextQuestion ? 0.2 : 0.45,
                },
                req.signal,
                directContextQuestion ? 45_000 : 75_000,
                (attemptProvider, attempt) => {
                  if (attempt > 1) {
                    send({ type: "agent_fallback", role, label: roleAlias(role), round, provider: attemptProvider, attempt });
                  }
                },
                (failedProvider, error, attempt) => {
                  send({ type: "agent_provider_failed", role, label: roleAlias(role), round, provider: failedProvider, attempt, error });
                },
              );
              raw = result.text;
              usedProvider = result.provider;
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err);
              send({ type: "agent_timeout", role, label: roleAlias(role), round, provider: effectiveProvider, error });
              continue;
            } finally {
              if (activeHeartbeat) {
                clearInterval(activeHeartbeat);
                activeHeartbeat = null;
              }
            }
            const content = sanitizeRoundtableOutput(raw);
            const passed = raw.includes("[PASS]") || content.length === 0;

            if (!passed) {
              disagreement = disagreement || hasHardDisagreement(content);
              conversation.push({ role, content });
              const msg = await prisma.message.create({
                data: {
                  projectId: project.id,
                  discussionId: discussion.id,
                  role,
                  model: usedProvider,
                  phase,
                  content,
                },
              });
              send({ type: "agent_done", role, label: roleAlias(role), round, provider: usedProvider, message: msg });
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
          const chroniclerProvider = routeProviderForRole("chronicler", provider, providerSettings, writingLanguage);
          const ctx = buildContext({
            projectSlug,
            role: "chronicler",
            task: summaryPrompt,
            phase,
            compact: false,
            includeCurrentPhase: true,
          });
          send({ type: "chronicler_start", role: "chronicler", label: roleAlias("chronicler") });
          const summary = await complete(chroniclerProvider, ctx.messages, {
            system: ctx.system,
            maxTokens: 5000,
            temperature: 0.3,
          }, req.signal);
          const summaryMessage = await prisma.message.create({
            data: {
              projectId: project.id,
              discussionId: discussion.id,
              role: "chronicler",
              model: chroniclerProvider,
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
        if (activeHeartbeat) clearInterval(activeHeartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Client may have already disconnected.
          }
        }
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
