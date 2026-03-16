import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");

interface Beat {
  id: string;          // e.g. "阳一.1"
  chapter: string;     // e.g. "阳一"
  title: string;       // short title
  summary: string;     // 1-2 sentence description
  key: boolean;        // key plot point → needs roundtable
  wordBudget: number;  // target word count
  status: "blank" | "writing" | "review" | "revising" | "done";
  wordCount?: number;  // actual words written (from draft file)
}

function beatsPath(slug: string): string {
  return join(DATA_DIR, slug, "structure", "beats.json");
}

function draftsDir(slug: string): string {
  return join(DATA_DIR, slug, "draft");
}

function summariesDir(slug: string): string {
  return join(DATA_DIR, slug, "draft-summaries");
}

// Cache chapter file contents so we don't re-read per beat
function getChapterWordCounts(slug: string, chapters: string[]): Record<string, number> {
  const draftDir = draftsDir(slug);
  const counts: Record<string, number> = {};
  for (const ch of chapters) {
    const chPath = join(draftDir, `${ch}.md`);
    if (existsSync(chPath)) {
      counts[ch] = readFileSync(chPath, "utf-8").length;
    }
  }
  return counts;
}

// Enrich beats with actual draft status from filesystem
// Supports both beat-level files (阳一.1.md) and chapter-level files (阳一.md)
function enrichBeats(beats: Beat[], slug: string): Beat[] {
  const draftDir = draftsDir(slug);
  const sumDir = summariesDir(slug);

  // Pre-scan chapter-level files
  const uniqueChapters = [...new Set(beats.map(b => b.chapter))];
  const chapterCounts = getChapterWordCounts(slug, uniqueChapters);

  // Count beats per chapter for word count distribution
  const beatsPerChapter: Record<string, number> = {};
  for (const b of beats) {
    beatsPerChapter[b.chapter] = (beatsPerChapter[b.chapter] || 0) + 1;
  }

  return beats.map(beat => {
    // Check beat-level file first (e.g. draft/阳一.1.md)
    const beatPath = join(draftDir, `${beat.id}.md`);
    const beatSumPath = join(sumDir, `${beat.id}.md`);

    if (existsSync(beatPath)) {
      const content = readFileSync(beatPath, "utf-8");
      const hasSummary = existsSync(beatSumPath);
      return {
        ...beat,
        wordCount: content.length,
        status: hasSummary ? "done" as const : "review" as const,
      };
    }

    // Check chapter-level file (e.g. draft/阳一.md)
    if (chapterCounts[beat.chapter] !== undefined) {
      const totalChars = chapterCounts[beat.chapter];
      const numBeats = beatsPerChapter[beat.chapter] || 1;
      // Distribute chapter word count proportionally by budget
      const chapterBeats = beats.filter(b => b.chapter === beat.chapter);
      const totalBudget = chapterBeats.reduce((s, b) => s + b.wordBudget, 0);
      const share = totalBudget > 0
        ? Math.round(totalChars * (beat.wordBudget / totalBudget))
        : Math.round(totalChars / numBeats);
      return {
        ...beat,
        wordCount: share,
        status: "done" as const,
      };
    }

    return { ...beat, status: beat.status || "blank" as const };
  });
}

// GET — list all beats with status
export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const path = beatsPath(projectSlug);
  if (!existsSync(path)) {
    return Response.json({ beats: [] });
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const beats: Beat[] = JSON.parse(raw);
    const enriched = enrichBeats(beats, projectSlug);
    return Response.json({ beats: enriched });
  } catch (err) {
    console.error("beats read error:", err);
    return Response.json({ error: "读取失败" }, { status: 500 });
  }
}

// POST — save/update the full beat sheet
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, beats } = body as {
      projectSlug: string;
      beats: Beat[];
    };

    if (!projectSlug || !beats) {
      return Response.json({ error: "projectSlug and beats required" }, { status: 400 });
    }

    const path = beatsPath(projectSlug);
    const dir = join(DATA_DIR, projectSlug, "structure");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(path, JSON.stringify(beats, null, 2), "utf-8");
    return Response.json({ ok: true, count: beats.length });
  } catch (err) {
    console.error("beats save error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}

// PATCH — update a single beat's status or content
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, beatId, updates } = body as {
      projectSlug: string;
      beatId: string;
      updates: Partial<Beat>;
    };

    if (!projectSlug || !beatId) {
      return Response.json({ error: "projectSlug and beatId required" }, { status: 400 });
    }

    const path = beatsPath(projectSlug);
    if (!existsSync(path)) {
      return Response.json({ error: "beats.json not found" }, { status: 404 });
    }

    const beats: Beat[] = JSON.parse(readFileSync(path, "utf-8"));
    const idx = beats.findIndex(b => b.id === beatId);
    if (idx < 0) {
      return Response.json({ error: `beat ${beatId} not found` }, { status: 404 });
    }

    beats[idx] = { ...beats[idx], ...updates };
    writeFileSync(path, JSON.stringify(beats, null, 2), "utf-8");

    return Response.json({ ok: true, beat: beats[idx] });
  } catch (err) {
    console.error("beat update error:", err);
    return Response.json({ error: "更新失败" }, { status: 500 });
  }
}
