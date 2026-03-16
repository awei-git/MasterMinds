/**
 * Model Bake-off: Have multiple models write the opening beat of 阳一,
 * then evaluate them side by side.
 *
 * Usage: npx tsx scripts/bakeoff.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

// Load .env manually (no dotenv dependency)
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
} catch { /* no .env file */ }

import { complete, type ModelProvider } from "../src/lib/llm";
import { buildContext } from "../src/lib/agents/context";

const MODELS: ModelProvider[] = ["claude-code", "gpt"];

const WRITING_PROMPT = `请写理埠阳一的第一个beat（约400-500字）。

场景：陶参坐船到达理埠。雾从水面升起。船靠岸。他带着一个箱子，里面是心理咨询的工具——量表、记录本、笔。码头是理埠唯一的进出口。

要求：
- 纯文学笔法，投《收获》的水准
- 第三人称有限视角，紧贴陶参
- 从感官入手：雾、水、湿气、声音
- 不解释他是谁、来干什么——让读者从细节里拼
- 系统永远不露真身
- 不用"他想""他觉得""他意识到"
- 段落有呼吸，长短交替
- 进场晚：不写上船、不写出发，直接从水面开始

只输出正文，不要标题、不要自检报告、不要解释。`;

async function runBakeoff() {
  console.log("=== 理埠 阳一 Model Bake-off ===\n");

  // Build context for writer role
  const ctx = buildContext({
    projectSlug: "理埠",
    role: "writer",
    task: WRITING_PROMPT,
    phase: "draft",
    skillGroup: "drafting",
  });

  const results: { provider: ModelProvider; text: string; timeMs: number }[] = [];

  // Run models sequentially for clean comparison
  for (const provider of MODELS) {
    console.log(`\n--- Running ${provider}... ---`);
    const start = Date.now();
    try {
      const text = await complete(provider, [{ role: "user", content: ctx.messages[0]?.content ?? WRITING_PROMPT }], {
        system: ctx.system,
        maxTokens: 2048,
        temperature: 0.7,
      });
      const elapsed = Date.now() - start;
      results.push({ provider, text: text.trim(), timeMs: elapsed });
      console.log(`✓ ${provider} done in ${(elapsed / 1000).toFixed(1)}s (${text.length} chars)`);
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(`✗ ${provider} failed after ${(elapsed / 1000).toFixed(1)}s:`, err instanceof Error ? err.message : err);
      results.push({ provider, text: `[ERROR: ${err instanceof Error ? err.message : "unknown"}]`, timeMs: elapsed });
    }
  }

  // Print all results
  console.log("\n\n========================================");
  console.log("========== RESULTS ==========");
  console.log("========================================\n");

  for (const r of results) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`MODEL: ${r.provider} | Time: ${(r.timeMs / 1000).toFixed(1)}s | Chars: ${r.text.length}`);
    console.log("=".repeat(60));
    console.log(r.text);
    console.log();
  }

  // Now evaluate with Gemini (fast, analytical)
  if (results.filter(r => !r.text.startsWith("[ERROR")).length >= 2) {
    console.log("\n\n========================================");
    console.log("========== EVALUATION ==========");
    console.log("========================================\n");

    const evalPrompt = `你是严肃文学评审。以下是不同AI模型对同一个写作任务的输出。请逐一评价，然后排名。

评价维度（每项10分）：
1. **语言质感**：句子有没有呼吸？段落长短是否交替？有没有AI味（华美空洞、工整无生气）？
2. **感官密度**：具体的、能拍照能录像的细节有多少？还是在用抽象词？
3. **克制**：有没有解释、总结、抒情？"他想/他觉得/他意识到"出现了几次？
4. **氛围**：雾、水、湿的质感是否贯穿？理埠作为一个地方有没有立起来？
5. **节奏**：开头是否进场晚？是否有不必要的铺垫？段落是否有推进感？

${results.map((r, i) => `---\n\n## 模型 ${String.fromCharCode(65 + i)} (${r.provider})\n\n${r.text}`).join("\n\n")}

---

请对每个模型逐一评分（5个维度各10分），给出总分和简短点评。最后排名并说明理由。`;

    try {
      const evaluation = await complete("gemini", [{ role: "user", content: evalPrompt }], {
        maxTokens: 4096,
        temperature: 0.3,
      });
      console.log(evaluation);
    } catch (err) {
      console.error("Evaluation failed:", err instanceof Error ? err.message : err);
    }
  }

  console.log("\n\nDone.");
}

runBakeoff().catch(console.error);
