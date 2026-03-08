/**
 * App Integration Protocol v2 — writes MasterMinds outputs to Mira feeds/apps/
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";
import { prisma } from "./db";

const FLOW_STEPS = [
  { key: "conception", label: "构思" },
  { key: "bible", label: "世界与角色" },
  { key: "structure", label: "结构" },
  { key: "draft", label: "写作" },
  { key: "review", label: "审稿" },
  { key: "final", label: "定稿" },
];

const DATA_DIR = join(process.cwd(), "data");
const MIRA_APPS_DIR = join(process.cwd(), "..", "Mira", "feeds", "apps");

function readPhaseSummary(slug: string, phase: string): { content: string; updatedAt: string } | null {
  const path = join(DATA_DIR, slug, "phases", `${phase}.md`);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  const stat = statSync(path);
  // Truncate to 4000 chars per protocol
  const trimmed = content.length > 4000 ? content.slice(0, 4000) + "\n…" : content;
  return { content: trimmed, updatedAt: stat.mtime.toISOString() };
}

export async function syncAppStatus() {
  try {
    const projects = await prisma.project.findMany({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
    });

    if (projects.length === 0) return;

    const outputs: Record<string, unknown>[] = [];

    for (const p of projects) {
      const phaseIdx = FLOW_STEPS.findIndex((s) => s.key === p.phase);
      const phaseLabel = FLOW_STEPS[phaseIdx]?.label ?? p.phase;

      // Collect completed phase summaries as highlights
      const highlights: string[] = [];
      for (const step of FLOW_STEPS) {
        if (readPhaseSummary(p.slug, step.key)) {
          highlights.push(`${step.label}阶段总结已完成`);
        }
      }

      // Output: progress
      outputs.push({
        type: "progress",
        id: p.slug,
        title: p.title,
        updatedAt: p.updatedAt.toISOString(),
        status: p.status,
        stage: {
          current: phaseIdx >= 0 ? phaseIdx + 1 : 1,
          total: FLOW_STEPS.length,
          label: phaseLabel,
        },
        highlights,
      });

      // Output: report per completed phase
      for (const step of FLOW_STEPS) {
        const summary = readPhaseSummary(p.slug, step.key);
        if (summary) {
          outputs.push({
            type: "report",
            id: `${p.slug}/${step.key}`,
            title: `${p.title} — ${step.label}阶段总结`,
            updatedAt: summary.updatedAt,
            period: "phase",
            content: summary.content,
            parent: p.slug,
          });
        }
      }
    }

    const feed = {
      app: "masterminds",
      version: 2,
      updatedAt: new Date().toISOString(),
      outputs,
    };

    // Write atomically
    if (!existsSync(MIRA_APPS_DIR)) {
      mkdirSync(MIRA_APPS_DIR, { recursive: true });
    }
    const targetPath = join(MIRA_APPS_DIR, "masterminds.json");
    const tempPath = targetPath + ".tmp";
    writeFileSync(tempPath, JSON.stringify(feed, null, 2), "utf-8");
    renameSync(tempPath, targetPath);
  } catch (err) {
    console.error("syncAppStatus error:", err);
  }
}
