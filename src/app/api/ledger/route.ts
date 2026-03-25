import { NextRequest } from "next/server";
import {
  loadLedger,
  saveLedger,
  extractAndUpdateLedger,
  type Ledger,
} from "@/lib/ledger";
import type { ModelProvider } from "@/lib/llm";

// GET — read current ledger
export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const ledger = loadLedger(projectSlug);
  return Response.json(ledger);
}

// PATCH — manual edit (user edits ledger directly in UI)
export async function PATCH(req: NextRequest) {
  try {
    const { projectSlug, ledger } = (await req.json()) as {
      projectSlug: string;
      ledger: Ledger;
    };

    if (!projectSlug || !ledger) {
      return Response.json({ error: "projectSlug and ledger required" }, { status: 400 });
    }

    saveLedger(projectSlug, ledger);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("ledger PATCH error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}

// POST — auto-extract from accepted beat content
export async function POST(req: NextRequest) {
  try {
    const { projectSlug, beatId, content, provider = "gemini" } = (await req.json()) as {
      projectSlug: string;
      beatId: string;
      content: string;
      provider?: ModelProvider;
    };

    if (!projectSlug || !beatId || !content) {
      return Response.json(
        { error: "projectSlug, beatId, and content required" },
        { status: 400 },
      );
    }

    const ledger = await extractAndUpdateLedger(projectSlug, beatId, content, provider);
    return Response.json(ledger);
  } catch (err) {
    console.error("ledger POST error:", err);
    return Response.json({ error: "提取失败" }, { status: 500 });
  }
}
