import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { complete, type ModelProvider } from "@/lib/llm";

const DATA_DIR = join(process.cwd(), "data");

function notesPath(slug: string, role: string): string {
  return join(DATA_DIR, slug, "memory", "agent-notes", `${role}.md`);
}

function globalNotesPath(role: string): string {
  return join(DATA_DIR, "global-agent-notes", `${role}.md`);
}

function readNotes(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return "";
}

function appendNote(path: string, note: string) {
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readNotes(path);
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `\n- [${timestamp}] ${note}`;
  writeFileSync(path, existing + entry + "\n", "utf-8");
}

// Role name mapping for detection
const ROLE_NAMES: Record<string, string> = {
  "灵犀": "idea",
  "鲁班": "architect",
  "画皮": "character",
  "妙笔": "writer",
  "铁面": "editor",
  "知音": "reader",
  "掌故": "continuity",
};

// GET: read agent notes
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("projectSlug");
  const role = req.nextUrl.searchParams.get("role");
  if (!role) return Response.json({ error: "role required" }, { status: 400 });

  const projectNotes = slug ? readNotes(notesPath(slug, role)) : "";
  const globalNotes = readNotes(globalNotesPath(role));

  return Response.json({ projectNotes, globalNotes });
}

// POST: absorb feedback — detect which agent, extract learning, save
export async function POST(req: NextRequest) {
  const { projectSlug, userMessage, recentMessages, provider = "claude-code" } = (await req.json()) as {
    projectSlug: string;
    userMessage: string;
    recentMessages: { role: string; content: string }[];
    provider?: ModelProvider;
  };

  if (!projectSlug || !userMessage) {
    return Response.json({ error: "projectSlug and userMessage required" }, { status: 400 });
  }

  // Build recent context (last few messages for understanding what the feedback is about)
  const contextStr = recentMessages
    .slice(-6)
    .map((m) => {
      const label = ROLE_NAMES[m.role] ? m.role : (Object.entries(ROLE_NAMES).find(([, v]) => v === m.role)?.[0] ?? m.role);
      return `[${label}]: ${m.content.slice(0, 500)}`;
    })
    .join("\n\n");

  // Use LLM to detect and extract feedback
  const extractionPrompt = `分析以下用户消息，判断是否包含对某个AI agent的反馈、纠正或指令。

## Agent列表
- 灵犀 (idea): 负责创意、角度
- 鲁班 (architect): 负责结构、大纲
- 画皮 (character): 负责角色
- 妙笔 (writer): 负责写作
- 铁面 (editor): 负责审稿
- 知音 (reader): 负责阅读评估
- 掌故 (continuity): 负责连续性

## 最近对话上下文
${contextStr}

## 用户消息
${userMessage}

## 任务
1. 判断用户是否在纠正、指导、批评某个特定agent的行为
2. 如果是，提取出可执行的学习点
3. 判断这个反馈是仅限当前项目的，还是适用于所有项目

输出JSON格式，不要其他内容：
- 如果没有agent反馈：{"hasFeedback": false}
- 如果有：{"hasFeedback": true, "targets": [{"role": "architect", "note": "需要更有耐心地迭代，不要抱怨讨论轮数多", "global": true}]}

targets可以有多个（用户可能同时对多个agent说话）。note要简洁（一句话）、可执行、用第二人称（"你应该..."或"不要..."）。global=true表示适用于所有项目。`;

  try {
    const raw = await complete(provider, [
      { role: "user", content: extractionPrompt },
    ], { temperature: 0.2 });

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ absorbed: false });

    const result = JSON.parse(jsonMatch[0]);
    if (!result.hasFeedback || !result.targets?.length) {
      return Response.json({ absorbed: false });
    }

    const absorbed: { role: string; note: string; scope: string }[] = [];

    for (const target of result.targets) {
      const role = target.role;
      const note = target.note;
      if (!role || !note) continue;

      // Save to project-level notes
      appendNote(notesPath(projectSlug, role), note);

      // Also save to global notes if applicable
      if (target.global) {
        appendNote(globalNotesPath(role), note);
      }

      absorbed.push({
        role,
        note,
        scope: target.global ? "global" : "project",
      });
    }

    return Response.json({ absorbed: true, items: absorbed });
  } catch (err) {
    console.error("Feedback absorption error:", err);
    return Response.json({ absorbed: false, error: String(err) });
  }
}
