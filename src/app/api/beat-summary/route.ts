import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { complete, MODEL_UTILITY } from "@/lib/llm";

const DATA_DIR = join(process.cwd(), "data");

function summaryPath(slug: string, beatId: string): string {
  return join(DATA_DIR, slug, "draft-summaries", `${beatId}.md`);
}

function draftPath(slug: string, beatId: string): string {
  const expansionPath = join(DATA_DIR, slug, "expansion", "chapters", `${beatId}.md`);
  if (existsSync(expansionPath)) return expansionPath;
  return join(DATA_DIR, slug, "draft", `${beatId}.md`);
}

// GET — read a beat summary
export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  const beatId = req.nextUrl.searchParams.get("beatId");

  if (!projectSlug || !beatId) {
    return Response.json({ error: "projectSlug and beatId required" }, { status: 400 });
  }

  const path = summaryPath(projectSlug, beatId);
  if (!existsSync(path)) {
    return Response.json({ summary: null });
  }

  return Response.json({ summary: readFileSync(path, "utf-8") });
}

// POST — generate a beat summary from the draft content
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, beatId } = body as {
      projectSlug: string;
      beatId: string;
    };

    if (!projectSlug || !beatId) {
      return Response.json({ error: "projectSlug and beatId required" }, { status: 400 });
    }

    const draft = draftPath(projectSlug, beatId);
    if (!existsSync(draft)) {
      return Response.json({ error: "draft not found for this beat" }, { status: 404 });
    }

    const content = readFileSync(draft, "utf-8");

    const result = await complete("deepseek", [
      {
        role: "user",
        content: `请用3-5句话总结以下段落。包含：(1)情节要点 (2)情绪基调 (3)埋下的伏笔或线索 (4)角色状态变化。不要评价，只记录事实。格式：

## ${beatId}
[摘要内容]
[情绪：...] [伏笔：...] [角色状态：...]

---

${content}`,
      },
    ], { model: MODEL_UTILITY.deepseek, maxTokens: 500 });

    // Save
    const dir = join(DATA_DIR, projectSlug, "draft-summaries");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(summaryPath(projectSlug, beatId), result, "utf-8");

    return Response.json({ summary: result });
  } catch (err) {
    console.error("beat summary error:", err);
    return Response.json({ error: "生成摘要失败" }, { status: 500 });
  }
}

// PATCH — manually edit a beat summary
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, beatId, summary } = body as {
      projectSlug: string;
      beatId: string;
      summary: string;
    };

    if (!projectSlug || !beatId || summary === undefined) {
      return Response.json({ error: "projectSlug, beatId, and summary required" }, { status: 400 });
    }

    const dir = join(DATA_DIR, projectSlug, "draft-summaries");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(summaryPath(projectSlug, beatId), summary, "utf-8");

    return Response.json({ ok: true });
  } catch (err) {
    console.error("beat summary save error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}
