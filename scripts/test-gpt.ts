import { readFileSync } from "fs";
import { join } from "path";

const envPath = join(process.cwd(), ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {}

import { complete } from "../src/lib/llm";
import { buildContext } from "../src/lib/agents/context";

const WRITING_PROMPT = `请写理埠阳一的第一个beat（约400-500字）。
场景：陶参坐船到达理埠。雾从水面升起。船靠岸。他带着一个箱子，里面是心理咨询的工具——量表、记录本、笔。码头是理埠唯一的进出口。
要求：纯文学笔法，第三人称有限视角，从感官入手，不解释他是谁、来干什么，不用"他想""他觉得""他意识到"，段落有呼吸。
只输出正文。`;

async function main() {
  const ctx = buildContext({
    projectSlug: "理埠",
    role: "writer",
    task: WRITING_PROMPT,
    phase: "draft",
    skillGroup: "drafting",
  });
  console.log("system prompt:", ctx.system.length, "chars");
  console.log("user message:", ctx.messages[0]?.content.length ?? 0, "chars");

  const start = Date.now();
  const text = await complete("gpt", [{ role: "user", content: ctx.messages[0]?.content ?? WRITING_PROMPT }], {
    system: ctx.system,
    maxTokens: 2048,
  });
  console.log("\nGPT time:", ((Date.now() - start) / 1000).toFixed(1) + "s");
  console.log("GPT output:", text.length, "chars");
  console.log("\n" + "=".repeat(60));
  console.log(text);
}

main().catch(console.error);
