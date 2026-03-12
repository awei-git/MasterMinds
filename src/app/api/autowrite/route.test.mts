/**
 * Tests for autowrite pipeline pure functions.
 * Run: node --test src/app/api/autowrite/route.test.mts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Copy pure functions from route.ts for isolated testing ───

function extractProse(raw: string): string {
  let text = raw;

  const tailMarkers = [
    /\n---\s*\n\s*#{1,3}\s*自检报告[\s\S]*/,
    /\n---\s*\n\s*#{1,3}\s*审稿意见采纳清单[\s\S]*/,
    /\n#{1,3}\s*自检报告[\s\S]*/,
    /\n#{1,3}\s*审稿意见采纳清单[\s\S]*/,
    /\n字数统计[：:][^\n]*[\s\S]*/,
  ];
  for (const marker of tailMarkers) {
    text = text.replace(marker, "");
  }

  const adoptionHeader = text.match(/^\s*(#{1,3}\s*(?:采纳清单|审稿意见采纳[^\n]*)[\s\S]*?\n---\s*\n)/);
  if (adoptionHeader) {
    text = text.slice(adoptionHeader[0].length);
  }

  return text.trim();
}

function editorPassed(editOutput: string): boolean {
  const last300 = editOutput.slice(-300);
  return /\bPASS\b/i.test(last300) || /无\s*P0/i.test(last300);
}

interface ChapterPlan { title: string; beats: string; }

function parseChapterPlan(raw: string): ChapterPlan[] | null {
  const allArrays = [...raw.matchAll(/\[[\s\S]*?\]/g)];
  for (let i = allArrays.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(allArrays[i][0]);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        return parsed.length > 1 ? (parsed as ChapterPlan[]) : null;
      }
    } catch { /* not valid JSON, try next */ }
  }
  const greedy = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (greedy) {
    try {
      const parsed = JSON.parse(greedy[0]);
      if (Array.isArray(parsed) && parsed.length > 1 && parsed[0].title) {
        return parsed as ChapterPlan[];
      }
    } catch { /* not valid JSON */ }
  }
  return null;
}

// ─── Tests ───

describe("extractProse", () => {
  it("returns pure prose with no markers", () => {
    const input = "这是一段纯正文。\n\n第二段正文。";
    assert.equal(extractProse(input), input);
  });

  it("strips trailing 自检报告 with --- separator", () => {
    const prose = "正文内容在这里。\n\n第二段。";
    const input = `${prose}\n\n---\n\n## 自检报告\n\n1. 检查了X\n2. 检查了Y`;
    assert.equal(extractProse(input), prose);
  });

  it("strips trailing 自检报告 without --- separator", () => {
    const prose = "正文内容。";
    const input = `${prose}\n\n## 自检报告\n\n内容`;
    assert.equal(extractProse(input), prose);
  });

  it("strips trailing 审稿意见采纳清单", () => {
    const prose = "正文。";
    const input = `${prose}\n\n## 审稿意见采纳清单\n\n| # | 内容 |`;
    assert.equal(extractProse(input), prose);
  });

  it("strips trailing 字数统计 and everything after", () => {
    const prose = "正文内容。";
    const input = `${prose}\n字数统计：2000字\n\n其他内容`;
    assert.equal(extractProse(input), prose);
  });

  it("strips leading 采纳清单 table with --- separator", () => {
    const prose = "# 一｜慢信邮局\n\n正文开始了。";
    const input = `## 采纳清单\n\n1. 保留了X\n2. 修改了Y\n\n---\n\n${prose}`;
    assert.equal(extractProse(input), prose);
  });

  it("strips leading 审稿意见采纳清单 with --- separator", () => {
    const prose = "正文开始。";
    const input = `## 审稿意见采纳清单\n\n| # | 处理 |\n|---|---|\n| 1 | 已改 |\n\n---\n\n${prose}`;
    assert.equal(extractProse(input), prose);
  });

  it("handles both leading 采纳清单 and trailing 自检报告", () => {
    const prose = "正文中间的好内容。";
    const input = `## 采纳清单\n1. X\n\n---\n\n${prose}\n\n## 自检报告\n1. OK`;
    assert.equal(extractProse(input), prose);
  });

  it("does NOT strip chapter headings that look like markers", () => {
    // This was the old bug — chapter heading # 一｜慢信邮局 should survive
    const input = "# 一｜慢信邮局\n\n她走进邮局，门铃叮当作响。\n\n# 二｜青梅时节\n\n院子里的青梅熟了。";
    assert.equal(extractProse(input), input);
  });

  it("does NOT destroy prose when no markers are present", () => {
    const longProse = "A".repeat(5000);
    assert.equal(extractProse(longProse), longProse);
  });

  it("handles empty input", () => {
    assert.equal(extractProse(""), "");
    assert.equal(extractProse("  \n\n  "), "");
  });

  it("handles # (h1) level 自检报告 heading", () => {
    const prose = "正文。";
    assert.equal(extractProse(`${prose}\n\n# 自检报告\n内容`), prose);
  });

  it("handles ### (h3) level 自检报告 heading", () => {
    const prose = "正文。";
    assert.equal(extractProse(`${prose}\n\n### 自检报告\n内容`), prose);
  });

  it("handles # (h1) level 采纳清单 leading section", () => {
    const prose = "正文开始。";
    assert.equal(extractProse(`# 采纳清单\n1. X\n\n---\n\n${prose}`), prose);
  });
});

describe("editorPassed", () => {
  it("detects PASS at end", () => {
    assert.ok(editorPassed("审稿报告...\n\n综合评价：PASS"));
  });

  it("detects pass (lowercase)", () => {
    assert.ok(editorPassed("一些内容...\n\npass"));
  });

  it("detects 无P0", () => {
    assert.ok(editorPassed("一些内容...\n\n无P0硬伤，整体可用。"));
  });

  it("detects 无 P0 with space", () => {
    assert.ok(editorPassed("一些内容...\n\n无 P0"));
  });

  it("does NOT false-positive on PASSIVE", () => {
    assert.ok(!editorPassed("avoid passive voice in this paragraph. P0: 3 issues found."));
  });

  it("does NOT false-positive on PASSED", () => {
    // "PASSED" should not match \bPASS\b — wait, "PASSED" has PASS at word boundary?
    // \bPASS\b matches "PASS" only when followed by a non-word char
    // "PASSED" → PASS is followed by E, a word char, so \bPASS\b won't match
    assert.ok(!editorPassed("The time has passed. P0: 5 issues remain."));
  });

  it("does NOT false-positive on COMPASS", () => {
    assert.ok(!editorPassed("like a compass pointing north. P0: found 2."));
  });

  it("returns false for normal rejection", () => {
    assert.ok(!editorPassed("P0硬伤3个，P1问题5个。\n\n## 修改优先级\n需要重大修改。"));
  });

  it("checks only last 300 chars", () => {
    const longText = "审稿意见 ".repeat(100) + "整体 PASS";
    assert.ok(editorPassed(longText));
    const tooFar = "整体 PASS\n\n" + "审稿意见 ".repeat(100);
    assert.ok(!editorPassed(tooFar));
  });
});

describe("parseChapterPlan", () => {
  it("parses valid multi-chapter JSON", () => {
    const input = `[{"title":"一｜慢信邮局","beats":"开场"},{"title":"二｜青梅时节","beats":"发展"}]`;
    const result = parseChapterPlan(input);
    assert.ok(result);
    assert.equal(result!.length, 2);
    assert.equal(result![0].title, "一｜慢信邮局");
  });

  it("returns null for single-chapter JSON", () => {
    const input = `[{"title":"全文","beats":"完整文章"}]`;
    assert.equal(parseChapterPlan(input), null);
  });

  it("returns null for no JSON", () => {
    assert.equal(parseChapterPlan("这是纯文本，没有JSON"), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseChapterPlan("[{invalid json}]"), null);
  });

  it("handles JSON with surrounding prose", () => {
    const input = `Based on the structure, here is the chapter plan:\n\n[{"title":"一","beats":"a"},{"title":"二","beats":"b"}]\n\nThat's the plan.`;
    const result = parseChapterPlan(input);
    assert.ok(result);
    assert.equal(result!.length, 2);
  });

  it("handles stray brackets in prose before JSON", () => {
    // Old bug: greedy [\\s\\S]* would match from first [ to last ]
    const input = `Based on the structure [above], here's the plan:\n[{"title":"一","beats":"a"},{"title":"二","beats":"b"}]`;
    const result = parseChapterPlan(input);
    assert.ok(result);
    assert.equal(result!.length, 2);
  });

  it("handles JSON with newlines inside values", () => {
    const input = `[{"title":"一｜开端","beats":"建立角色\\n引入冲突"},{"title":"二｜发展","beats":"升级冲突"}]`;
    const result = parseChapterPlan(input);
    assert.ok(result);
    assert.equal(result!.length, 2);
  });

  it("returns null for array without title field", () => {
    assert.equal(parseChapterPlan(`[{"name":"a"},{"name":"b"}]`), null);
  });

  it("handles multi-line formatted JSON", () => {
    const input = `[\n  {"title": "一", "beats": "开场"},\n  {"title": "二", "beats": "发展"}\n]`;
    const result = parseChapterPlan(input);
    assert.ok(result);
    assert.equal(result!.length, 2);
  });
});

// ─── Integration-style tests for extractProse with real-world patterns ───

describe("extractProse — real-world patterns", () => {
  it("handles writer revision with 采纳清单 + prose + 自检报告", () => {
    const input = `## 审稿意见采纳清单

| # | 问题 | 处理 |
|---|------|------|
| 1 | 碎片化断句 | 已合并 |
| 2 | said bookism | 已改 |

---

# 一｜慢信邮局

她走进邮局的时候，门铃叮当作响。柜台后面的老人抬起头，眼镜滑到鼻尖。

"寄信还是取信？"

她犹豫了一下。"都有。"

---

## 自检报告

1. 碎片化断句：已修复
2. 对话标记：已简化`;
    const result = extractProse(input);
    assert.ok(result.startsWith("# 一｜慢信邮局"));
    assert.ok(result.includes("她走进邮局"));
    assert.ok(result.includes("都有。"));
    assert.ok(!result.includes("采纳清单"));
    assert.ok(!result.includes("自检报告"));
  });

  it("handles prose that contains --- between sections (not markers)", () => {
    const input = `# 一｜开端

正文第一章。

---

# 二｜发展

正文第二章。`;
    const result = extractProse(input);
    assert.ok(result.includes("正文第一章"));
    assert.ok(result.includes("正文第二章"));
  });

  it("preserves prose when writer only outputs clean text", () => {
    const cleanOutput = `# 深空回声

## 一｜慢信邮局

邮局在小镇的尽头，青瓦白墙，门前一棵老槐树。

夏天的时候，蝉声像潮水一样涨上来，把整个邮局淹没在嗡嗡的震动里。`;
    assert.equal(extractProse(cleanOutput), cleanOutput);
  });
});
