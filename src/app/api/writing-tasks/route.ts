import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/db";
import { complete, type ModelProvider } from "@/lib/llm";
import { buildContext } from "@/lib/agents/context";
import type { RoleName } from "@/lib/agents/roles";
import { normalizePhase, phaseDefinition, writingTaskPrompt } from "@/lib/workflow";

const DATA_DIR = join(process.cwd(), "data");

type WritingTaskKind =
  | "bible_draft"
  | "bible_revision"
  | "beat_sheet"
  | "beat_revision"
  | "scriptment"
  | "scriptment_revision"
  | "chapter_briefing"
  | "chapter_draft"
  | "chapter_revision"
  | "full_review_plan";

interface WritingTaskRequest {
  projectSlug: string;
  kind: WritingTaskKind;
  provider?: ModelProvider;
  role?: RoleName;
  instruction?: string;
  chapterId?: string;
  save?: boolean;
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function artifactPath(slug: string, kind: WritingTaskKind, chapterId?: string): string {
  const base = join(DATA_DIR, slug);
  const chapter = chapterId || "chapter-01";
  const map: Record<WritingTaskKind, string> = {
    bible_draft: join(base, "bible", "bible.md"),
    bible_revision: join(base, "bible", "bible.md"),
    beat_sheet: join(base, "structure", "outline.md"),
    beat_revision: join(base, "structure", "outline.md"),
    scriptment: join(base, "scriptment", "scriptment.md"),
    scriptment_revision: join(base, "scriptment", "scriptment.md"),
    chapter_briefing: join(base, "expansion", "briefings", `${chapter}.md`),
    chapter_draft: join(base, "expansion", "chapters", `${chapter}.md`),
    chapter_revision: join(base, "expansion", "chapters", `${chapter}.md`),
    full_review_plan: join(base, "reviews", "full-review-plan.md"),
  };
  return map[kind];
}

function inferRole(kind: WritingTaskKind, fallback?: RoleName): RoleName {
  if (fallback) return fallback;
  if (kind.startsWith("bible")) return "character";
  if (kind.startsWith("beat")) return "architect";
  if (kind === "chapter_briefing") return "architect";
  if (kind === "full_review_plan") return "editor";
  return "writer";
}

function collectArtifactContext(slug: string, kind: WritingTaskKind, chapterId?: string): string {
  const base = join(DATA_DIR, slug);
  const parts: string[] = [];

  const conception = readIfExists(join(base, "phases", "conception.md"));
  const bibleSummary = readIfExists(join(base, "phases", "bible.md"));
  const structureSummary = readIfExists(join(base, "phases", "structure.md"));
  const scriptmentSummary = readIfExists(join(base, "phases", "scriptment.md"));
  const spec = readIfExists(join(base, "spec.md"));
  const scriptment = readIfExists(join(base, "scriptment", "scriptment.md"));

  if (conception) parts.push(`# 构思纪要\n\n${conception}`);
  if (bibleSummary) parts.push(`# Bible 纪要\n\n${bibleSummary}`);
  if (structureSummary) parts.push(`# 结构纪要\n\n${structureSummary}`);
  if (scriptmentSummary) parts.push(`# Scriptment 审稿纪要\n\n${scriptmentSummary}`);
  if (spec) parts.push(`# 写作规格书\n\n${spec}`);
  if (scriptment) parts.push(`# Scriptment 全文\n\n${scriptment}`);

  if (chapterId) {
    const briefing = readIfExists(join(base, "expansion", "briefings", `${chapterId}.md`));
    const currentChapter = readIfExists(join(base, "expansion", "chapters", `${chapterId}.md`));
    if (briefing) parts.push(`# 本章 briefing\n\n${briefing}`);
    if (currentChapter && kind === "chapter_revision") parts.push(`# 当前章原稿\n\n${currentChapter}`);
  }

  return parts.join("\n\n---\n\n");
}

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  const kind = req.nextUrl.searchParams.get("kind") as WritingTaskKind | null;
  const chapterId = req.nextUrl.searchParams.get("chapterId") ?? undefined;

  if (!projectSlug || !kind) {
    return Response.json({ error: "projectSlug and kind required" }, { status: 400 });
  }

  const path = artifactPath(projectSlug, kind, chapterId);
  if (!existsSync(path)) return Response.json({ content: null, path });
  return Response.json({ content: readFileSync(path, "utf-8"), path });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WritingTaskRequest;
    const {
      projectSlug,
      kind,
      provider = "claude-code",
      instruction = "",
      chapterId,
      save = true,
    } = body;

    if (!projectSlug || !kind) {
      return Response.json({ error: "projectSlug and kind required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (!project) return Response.json({ error: "project not found" }, { status: 404 });

    const phase = normalizePhase(project.phase);
    const role = inferRole(kind, body.role);
    const basePrompt = writingTaskPrompt(kind);
    const phaseDef = phaseDefinition(phase);
    const artifactContext = collectArtifactContext(projectSlug, kind, chapterId);

    const task = [
      `# 独立写作任务：${kind}`,
      `当前阶段：${phaseDef.label}`,
      basePrompt,
      chapterId ? `章节 ID：${chapterId}` : "",
      instruction ? `# 创作者补充指令\n\n${instruction}` : "",
      artifactContext ? `# 参考材料\n\n${artifactContext}` : "",
    ].filter(Boolean).join("\n\n");

    const ctx = buildContext({
      projectSlug,
      role,
      task,
      phase,
      compact: phase === "expansion",
      skillGroup: kind.includes("revision") ? "revision" : undefined,
    });

    const result = await complete(provider, ctx.messages, {
      system: ctx.system,
      maxTokens: kind === "scriptment" ? 32000 : 16000,
      thinking: provider === "claude",
    }, req.signal);

    if (!result?.trim()) {
      return Response.json({ error: "model returned empty result" }, { status: 500 });
    }

    const path = artifactPath(projectSlug, kind, chapterId);
    if (save) {
      const dir = join(path, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, result, "utf-8");

      await prisma.message.create({
        data: {
          projectId: project.id,
          role,
          model: provider,
          phase,
          content: `【独立写作任务：${kind}】\n保存路径：${path.replace(process.cwd() + "/", "")}\n\n${result}`,
          metadata: JSON.stringify({ kind, chapterId, artifactPath: path }),
        },
      });
    }

    return Response.json({ content: result, path, saved: save });
  } catch (err) {
    console.error("writing task error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "writing task failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { projectSlug, kind, chapterId, content } = (await req.json()) as {
      projectSlug: string;
      kind: WritingTaskKind;
      chapterId?: string;
      content: string;
    };

    if (!projectSlug || !kind || content === undefined) {
      return Response.json({ error: "projectSlug, kind, and content required" }, { status: 400 });
    }

    const path = artifactPath(projectSlug, kind, chapterId);
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, "utf-8");
    return Response.json({ ok: true, path });
  } catch (err) {
    console.error("writing task save error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}
