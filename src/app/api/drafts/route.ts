import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");

function draftsDir(slug: string): string {
  return join(DATA_DIR, slug, "draft");
}

// GET — list all saved draft sections with their content
export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const dir = draftsDir(projectSlug);
  if (!existsSync(dir)) {
    return Response.json({ sections: [] });
  }

  // If sectionId is provided, return just that section (or its chapter)
  const sectionId = req.nextUrl.searchParams.get("sectionId");
  if (sectionId) {
    // Try beat-level file first, then chapter-level
    const beatPath = join(dir, `${sectionId}.md`);
    if (existsSync(beatPath)) {
      const content = readFileSync(beatPath, "utf-8");
      return Response.json({ content, charCount: content.length });
    }
    // Try chapter file (e.g. sectionId="阳一.1" → chapter="阳一")
    const chapter = sectionId.split(".")[0];
    const chapterPath = join(dir, `${chapter}.md`);
    if (existsSync(chapterPath)) {
      const content = readFileSync(chapterPath, "utf-8");
      return Response.json({ content, charCount: content.length, isChapter: true });
    }
    return Response.json({ content: null });
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort(); // alphabetical: 阳一.1, 阳一.2, 阳二.1, etc.

  const sections = files.map((f) => {
    const content = readFileSync(join(dir, f), "utf-8");
    const id = f.replace(".md", "");
    return { id, content, charCount: content.length };
  });

  return Response.json({ sections });
}

// POST — save a draft section (e.g. "阳三.1" or "阴一")
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, sectionId, content } = body as {
      projectSlug: string;
      sectionId: string; // e.g. "阳一.1", "阳一.2", "阴一"
      content: string;
    };

    if (!projectSlug || !sectionId || !content) {
      return Response.json({ error: "projectSlug, sectionId, and content required" }, { status: 400 });
    }

    const dir = draftsDir(projectSlug);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = join(dir, `${sectionId}.md`);
    writeFileSync(filePath, content, "utf-8");

    return Response.json({ ok: true, sectionId, charCount: content.length });
  } catch (err) {
    console.error("draft save error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}

// DELETE — delete a draft section
export async function DELETE(req: NextRequest) {
  try {
    const projectSlug = req.nextUrl.searchParams.get("projectSlug");
    const sectionId = req.nextUrl.searchParams.get("sectionId");

    if (!projectSlug || !sectionId) {
      return Response.json({ error: "projectSlug and sectionId required" }, { status: 400 });
    }

    const filePath = join(draftsDir(projectSlug), `${sectionId}.md`);
    if (existsSync(filePath)) {
      const { unlinkSync } = require("fs");
      unlinkSync(filePath);
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("draft delete error:", err);
    return Response.json({ error: "删除失败" }, { status: 500 });
  }
}
