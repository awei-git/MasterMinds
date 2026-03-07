import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  listProjects,
  listArchivedProjects,
  archiveProject,
  unarchiveProject,
  deleteProject,
} from "@/lib/project";
import { prisma } from "@/lib/db";

// GET — list active projects (add ?archived=1 for archived)
export async function GET(req: NextRequest) {
  const showArchived = req.nextUrl.searchParams.get("archived") === "1";
  const projects = showArchived
    ? await listArchivedProjects()
    : await listProjects();
  return NextResponse.json(projects);
}

// POST — create new project
export async function POST(req: Request) {
  const body = await req.json();
  const { title, type, config } = body;

  if (!title || !type) {
    return NextResponse.json({ error: "title and type required" }, { status: 400 });
  }

  try {
    const project = await createProject(title, type, config ?? {});
    return NextResponse.json(project);
  } catch (err) {
    console.error("createProject error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create project" },
      { status: 409 }
    );
  }
}

// PATCH — archive / unarchive / setPhase
export async function PATCH(req: Request) {
  const body = await req.json();
  const { slug, action } = body;
  if (!slug || !action) {
    return NextResponse.json({ error: "slug and action required" }, { status: 400 });
  }

  try {
    if (action === "archive") {
      await archiveProject(slug);
      return NextResponse.json({ ok: true });
    }
    if (action === "unarchive") {
      await unarchiveProject(slug);
      return NextResponse.json({ ok: true });
    }
    if (action === "setPhase") {
      const updated = await prisma.project.update({
        where: { slug },
        data: { phase: body.phase },
      });
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: 400 }
    );
  }
}

// DELETE — permanent delete (irreversible)
export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  await deleteProject(slug);
  return NextResponse.json({ ok: true });
}
