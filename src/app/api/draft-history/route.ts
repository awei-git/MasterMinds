import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");

interface Round {
  round: number;
  draft: string;
  review?: string;
  approved?: boolean;
  timestamp: string;
}

function historyPath(slug: string, beatId: string): string {
  return join(DATA_DIR, slug, "draft-history", `${beatId}.json`);
}

// GET — read revision history for a beat
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("projectSlug");
  const beatId = req.nextUrl.searchParams.get("beatId");

  if (!slug || !beatId) {
    return Response.json({ error: "projectSlug and beatId required" }, { status: 400 });
  }

  const path = historyPath(slug, beatId);
  if (!existsSync(path)) {
    return Response.json({ rounds: [] });
  }

  const rounds: Round[] = JSON.parse(readFileSync(path, "utf-8"));
  return Response.json({ rounds });
}

// POST — append a round entry (draft, review, or both)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectSlug, beatId, draft, review, approved } = body as {
      projectSlug: string;
      beatId: string;
      draft?: string;
      review?: string;
      approved?: boolean;
    };

    if (!projectSlug || !beatId) {
      return Response.json({ error: "projectSlug and beatId required" }, { status: 400 });
    }

    const dir = join(DATA_DIR, projectSlug, "draft-history");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const path = historyPath(projectSlug, beatId);
    let rounds: Round[] = [];
    if (existsSync(path)) {
      rounds = JSON.parse(readFileSync(path, "utf-8"));
    }

    const lastRound = rounds[rounds.length - 1];

    // If adding review to existing round (same round, draft already saved)
    if (review && lastRound && !lastRound.review && lastRound.draft) {
      lastRound.review = review;
      lastRound.approved = approved ?? false;
    } else if (draft) {
      // New round with draft
      rounds.push({
        round: rounds.length + 1,
        draft,
        review: review || undefined,
        approved: approved ?? undefined,
        timestamp: new Date().toISOString(),
      });
    }

    writeFileSync(path, JSON.stringify(rounds, null, 2), "utf-8");
    return Response.json({ ok: true, totalRounds: rounds.length });
  } catch (err) {
    console.error("draft-history save error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}
