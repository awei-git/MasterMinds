import { NextRequest } from "next/server";
import { stream, complete, type ModelProvider } from "@/lib/llm";
import { loadSkills } from "@/lib/agents/context";

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Load skills once at module level (filesystem reads, cached after first load)
const SKILLS = {
  angle:     loadSkills("idea"),
  structure: loadSkills("architect"),
  draft:     loadSkills("writer"),
  edit:      loadSkills("editor"),
  revise:    loadSkills("writer"),
};

function withSkills(base: string, skills: string): string {
  return skills ? `${base}\n\n---\n\n${skills}` : base;
}

const SYSTEM_BASE = {
  angle: `你是一个敏锐的创意编辑。从原始材料中提炼最有价值的写作角度。

输出：
## 核心主张
（一句话，可争论的观点）

## 切入角度
（为什么这个角度，而不是别的）

## 开篇钩子
（第一句话或第一段的思路）

## 材料取舍
（保留什么，舍弃什么）

## 建议长度
（字数 + 理由）`,

  structure: `你是结构专家。把角度和材料转化为紧凑的文章结构。

要求：
- 每个部分有明确功能（建立张力/转折/深化/收束），不只是主题
- 开头不废话，结尾不总结
- 每部分给一个"关键句"（这部分必须完成的最重要的一句话）

输出：
## 标题备选（2-3个）

## 结构
### [部分名]：[功能标签]
关键句：
内容要点：
字数：

## 结构逻辑`,

  draft: `你是严肃文学作家。把结构变成活的文字。

核心纪律：
- 用不完整代替完整——写感知，不写总结
- 用动作代替心理——写情绪的身体，不写情绪的名字
- 用具体代替抽象——名词可以拍照，动词可以录像
- 进场晚，离场早

禁止：碎片化断句 / 格言堆叠 / 大段心理独白 / 总结陈词式结尾 / AI腔

写完整篇文章。`,

  edit: `你是严厉的责编。拦住不该过的稿子。

审稿顺序（P0最高优先）：
- P0 硬伤：逻辑漏洞，论据不支持论点，自相矛盾
- P1 结构：顺序不对，某部分功能失效，开头结尾拖沓
- P2 prose：AI腔，堆砌，无效句子，断句失控
- P3 可选：更好的可能性

每条意见必须：引用具体句子 + 说明违反什么原则 + 给出具体修改方向

结尾单独一行写评级：PASS（无P0/P1问题）或 REVISE（有需要修改的问题）`,

  revise: `你是严肃文学作家，根据编辑意见修改稿子。

要求：
- 逐条处理意见：采纳/拒绝，一行说明
- 采纳的意见：真正改，不是表面改
- 修改后整体必须更好，不只是修了几个点
- 保持原有文章的声音

先输出意见处理表（简短），再输出修改后完整文章。`,
};

async function runStream(
  provider: ModelProvider,
  system: string,
  userMsg: string,
  send: (data: object) => void,
  agentKey: string
): Promise<string> {
  let output = "";
  await stream(
    provider,
    [{ role: "user", content: userMsg }],
    { system },
    {
      onText: (t) => {
        output += t;
        send({ agent: agentKey, text: t, stage: "text" });
      },
      onDone: () => send({ agent: agentKey, text: "", stage: "done" }),
      onError: (e) => send({ agent: agentKey, error: e.message, stage: "error" }),
    }
  );
  return output;
}

function editorPassedOrMaxRounds(editOutput: string, round: number, maxRounds: number): boolean {
  if (round >= maxRounds) return true;
  // Stop if editor explicitly says PASS, or no P0/P1 issues found
  const last200 = editOutput.slice(-200).toUpperCase();
  return last200.includes("PASS") || last200.includes("无P0") || last200.includes("无 P0");
}

export async function POST(req: NextRequest) {
  const { material, provider = "claude-code", maxRounds = 3 } = (await req.json()) as {
    material: string;
    provider?: ModelProvider;
    maxRounds?: number;
  };

  if (!material?.trim()) {
    return Response.json({ error: "material required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(sseEvent(data)));

      try {
        // ── Stage 1: Angle ────────────────────────────────────────
        send({ agent: "angle", label: "灵犀 · 找角度", stage: "start" });
        const angleOutput = await runStream(
          provider, withSkills(SYSTEM_BASE.angle, SKILLS.angle),
          `分析以下原始材料，找到最佳写作角度：\n\n${material}`,
          send, "angle"
        );

        // ── Stage 2: Structure ────────────────────────────────────
        send({ agent: "structure", label: "鲁班 · 定结构", stage: "start" });
        const structureOutput = await runStream(
          provider, withSkills(SYSTEM_BASE.structure, SKILLS.structure),
          `原始材料：\n${material}\n\n---\n\n角度分析：\n${angleOutput}\n\n---\n\n请制作文章结构。`,
          send, "structure"
        );

        // ── Stage 3: First draft ──────────────────────────────────
        send({ agent: "draft", label: "妙笔 · 写初稿", stage: "start", round: 0 });
        let currentDraft = await runStream(
          provider, withSkills(SYSTEM_BASE.draft, SKILLS.draft),
          `原始材料：\n${material}\n\n---\n\n角度：\n${angleOutput}\n\n---\n\n结构：\n${structureOutput}\n\n---\n\n按以上结构写完整篇文章。`,
          send, "draft"
        );

        // ── Stages 4+: Iterative edit → revise ───────────────────
        let round = 1;
        while (round <= maxRounds) {
          send({ agent: "edit", label: `铁面 · 第${round}轮审稿`, stage: "start", round });
          const editOutput = await runStream(
            provider, withSkills(SYSTEM_BASE.edit, SKILLS.edit),
            `请审阅以下稿子（第${round}轮）：\n\n${currentDraft}`,
            send, "edit"
          );

          const done = editorPassedOrMaxRounds(editOutput, round, maxRounds);
          if (done && editOutput.toUpperCase().includes("PASS")) {
            send({ agent: "edit", stage: "passed", round });
            break;
          }

          send({ agent: "revise", label: `妙笔 · 第${round}轮修改`, stage: "start", round });
          currentDraft = await runStream(
            provider, withSkills(SYSTEM_BASE.revise, SKILLS.revise),
            `原稿：\n${currentDraft}\n\n---\n\n编辑意见（第${round}轮）：\n${editOutput}\n\n---\n\n请修改。`,
            send, "revise"
          );

          if (done) break;
          round++;
        }

        send({ done: true, result: currentDraft });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "pipeline failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
