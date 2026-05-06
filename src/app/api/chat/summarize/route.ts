import { NextRequest } from "next/server";
import { complete, MODEL_UTILITY } from "@/lib/llm";

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as {
    messages: { role: string; content: string }[];
  };

  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const conversation = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  // All summarization uses DeepSeek, independent of the active writing/review model.
  const summary = await complete(
    "deepseek",
    [{ role: "user", content: conversation }],
    {
      model: MODEL_UTILITY.deepseek,
      system:
        "用一句简短的中文概括以下对话的核心内容（15字以内）。只输出概括，不要加引号或其他格式。",
    }
  );

  return Response.json({ summary: summary.trim() });
}
