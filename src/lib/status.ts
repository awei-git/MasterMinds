/**
 * App status — writes data/status.json for Mira to read via registry.
 * Each app manages its own output. Mira reads from here, never the other way.
 */
import { existsSync, writeFileSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";
import { prisma } from "./db";
import { PHASES, normalizePhase } from "./workflow";

const FLOW_STEPS = PHASES.map((phase) => ({ key: phase.key, label: phase.label }));

const DATA_DIR = join(process.cwd(), "data");
const STATUS_PATH = join(DATA_DIR, "status.json");

function readPhaseSummaryMeta(slug: string, phase: string): { path: string; updatedAt: string; size: number } | null {
  const filePath = join(DATA_DIR, slug, "phases", `${phase}.md`);
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  if (stat.size === 0) return null;
  return {
    path: `data/${slug}/phases/${phase}.md`,
    updatedAt: stat.mtime.toISOString(),
    size: stat.size,
  };
}

export async function syncAppStatus() {
  try {
    const projects = await prisma.project.findMany({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
    });

    const outputs: Record<string, unknown>[] = [];

    for (const p of projects) {
      const currentPhase = normalizePhase(p.phase);
      const phaseIdx = FLOW_STEPS.findIndex((s) => s.key === currentPhase);
      const phaseLabel = FLOW_STEPS[phaseIdx]?.label ?? p.phase;

      const completedPhases: string[] = [];
      const reports: { phase: string; label: string; path: string; updatedAt: string; size: number }[] = [];

      for (const step of FLOW_STEPS) {
        const meta = readPhaseSummaryMeta(p.slug, step.key);
        if (meta) {
          completedPhases.push(`${step.label}阶段总结已完成`);
          reports.push({ phase: step.key, label: step.label, ...meta });
        }
      }

      // Progress
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
        highlights: completedPhases,
      });

      // Report references (paths, not content — Mira reads files directly)
      for (const r of reports) {
        outputs.push({
          type: "report",
          id: `${p.slug}/${r.phase}`,
          title: `${p.title} — ${r.label}阶段总结`,
          updatedAt: r.updatedAt,
          period: "phase",
          path: r.path,
          size: r.size,
          parent: p.slug,
        });
      }
    }

    const status = {
      app: "masterminds",
      version: 2,
      updatedAt: new Date().toISOString(),
      outputs,
    };

    // Write atomically
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempPath = STATUS_PATH + ".tmp";
    writeFileSync(tempPath, JSON.stringify(status, null, 2), "utf-8");
    renameSync(tempPath, STATUS_PATH);
  } catch (err) {
    console.error("syncAppStatus error:", err);
  }
}
