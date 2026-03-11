import { NextRequest } from "next/server";
import { complete, MODEL_UTILITY, type ModelProvider } from "@/lib/llm";

export async function POST(req: NextRequest) {
  const { messages, provider = "claude" } = (await req.json()) as {
    messages: { role: string; content: string }[];
    provider?: ModelProvider;
  };

  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const conversation = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  // Use utility model for summarization — don't burn Claude Max on a 15-char summary
  const summary = await complete(
    provider,
    [{ role: "user", content: conversation }],
    {
      model: MODEL_UTILITY[provider],
      system:
        "用一句简短的中文概括以下对话的核心内容（15字以内）。只输出概括，不要加引号或其他格式。",
    }
  );

  return Response.json({ summary: summary.trim() });
}
