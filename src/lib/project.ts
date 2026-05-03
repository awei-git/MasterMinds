import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { prisma } from "./db";

const DATA_DIR = join(process.cwd(), "data");

const PROJECT_DIRS = [
  "meta",
  "phases",
  "bible/characters",
  "structure/scenes",
  "scriptment",
  "expansion/chapters",
  "expansion/briefings",
  "expansion/reviews",
  "draft", // legacy compatibility
  "reviews/chapters",
  "continuity",
  "discussions",
  "memory/agent-notes",
  "memory/chapter-summaries",
  "memory/discussion-summaries",
];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function createProject(
  title: string,
  type: "novel" | "screenplay",
  config: Record<string, unknown> = {}
) {
  const slug = slugify(title) || `project-${Date.now()}`;

  // Check for slug collision — refuse if active project exists with same name
  const existing = await prisma.project.findUnique({ where: { slug } });
  if (existing) {
    if (existing.status === "archived") {
      throw new Error(`已有同名归档项目「${title}」。请先恢复或永久删除该归档项目，再创建新项目。`);
    }
    throw new Error(`已有同名项目「${title}」正在进行中。`);
  }

  const projectPath = join(DATA_DIR, slug);

  // Create filesystem structure
  for (const dir of PROJECT_DIRS) {
    mkdirSync(join(projectPath, dir), { recursive: true });
  }

  // Initialize meta
  const meta = {
    title,
    type,
    phase: "conception",
    workflowVersion: 3,
    createdAt: new Date().toISOString(),
    ...config,
  };
  writeFileSync(
    join(projectPath, "meta", "project.json"),
    JSON.stringify(meta, null, 2)
  );

  // Initialize empty memory files
  writeFileSync(join(projectPath, "memory", "project-memory.md"), "");
  writeFileSync(join(projectPath, "memory", "style-guide.md"), "");
  writeFileSync(join(projectPath, "memory", "decisions.md"), "");

  // Create DB record
  const project = await prisma.project.create({
    data: {
      slug,
      title,
      type,
      config: JSON.stringify(config),
    },
  });

  return project;
}

// Only return active projects by default
export async function listProjects() {
  return prisma.project.findMany({
    where: { status: "active" },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProject(slug: string) {
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project) return null;

  // Load filesystem meta
  const metaPath = join(DATA_DIR, slug, "meta", "project.json");
  let meta: Record<string, unknown> = {};
  if (existsSync(metaPath)) {
    meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  }

  return { ...project, meta };
}

// Archive a project — hides from list, frees up the slug for reuse
export async function archiveProject(slug: string) {
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project) throw new Error("项目不存在");

  // Rename slug so new projects can reuse the name
  const archivedSlug = `__archived__${slug}__${Date.now()}`;
  await prisma.project.update({
    where: { slug },
    data: { status: "archived", slug: archivedSlug },
  });

  // Rename data directory
  const oldPath = join(DATA_DIR, slug);
  const newPath = join(DATA_DIR, archivedSlug);
  if (existsSync(oldPath)) {
    const { renameSync } = await import("fs");
    renameSync(oldPath, newPath);
  }

  return archivedSlug;
}

// Unarchive — restore the original slug
export async function unarchiveProject(archivedSlug: string) {
  const project = await prisma.project.findUnique({ where: { slug: archivedSlug } });
  if (!project) throw new Error("项目不存在");

  // Extract original slug
  const originalSlug = archivedSlug.replace(/^__archived__/, "").replace(/__\d+$/, "");

  // Check if original slug is now taken
  const conflict = await prisma.project.findUnique({ where: { slug: originalSlug } });
  if (conflict) {
    throw new Error(`无法恢复：已有同名项目「${project.title}」正在进行中。`);
  }

  await prisma.project.update({
    where: { slug: archivedSlug },
    data: { status: "active", slug: originalSlug },
  });

  // Rename data directory back
  const oldPath = join(DATA_DIR, archivedSlug);
  const newPath = join(DATA_DIR, originalSlug);
  if (existsSync(oldPath)) {
    const { renameSync } = await import("fs");
    renameSync(oldPath, newPath);
  }
}

// List archived projects separately
export async function listArchivedProjects() {
  return prisma.project.findMany({
    where: { status: "archived" },
    orderBy: { updatedAt: "desc" },
  });
}

// Permanently delete — irreversible, removes everything
export async function deleteProject(slug: string) {
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project) return;

  // Delete all related data
  await prisma.clip.deleteMany({ where: { projectId: project.id } });
  await prisma.message.deleteMany({ where: { projectId: project.id } });
  await prisma.discussion.deleteMany({ where: { projectId: project.id } });
  await prisma.project.delete({ where: { slug } });

  // Delete filesystem data
  const projectPath = join(DATA_DIR, slug);
  if (existsSync(projectPath)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

export async function updateProjectPhase(slug: string, phase: string) {
  // Update DB
  await prisma.project.update({
    where: { slug },
    data: { phase },
  });

  // Update filesystem meta
  const metaPath = join(DATA_DIR, slug, "meta", "project.json");
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    meta.phase = phase;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}
