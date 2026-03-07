import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const projectSlug = req.nextUrl.searchParams.get("projectSlug");
    if (!projectSlug) {
      return Response.json([]);
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json([]);
    }

    const clips = await prisma.clip.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(clips);
  } catch (err) {
    console.error("clips GET error:", err);
    return Response.json([], { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const { projectSlug, content, source } = await req.json();

    if (!projectSlug || !content) {
      return Response.json({ error: "projectSlug and content required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }

    const clip = await prisma.clip.create({
      data: {
        projectId: project.id,
        content,
        source: source ?? null,
      },
    });

    return Response.json(clip);
  } catch (err) {
    console.error("clips POST error:", err);
    return Response.json({ error: "保存失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return Response.json({ error: "id required" }, { status: 400 });
    }

    await prisma.clip.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("clips DELETE error:", err);
    return Response.json({ error: "删除失败" }, { status: 500 });
  }
}
