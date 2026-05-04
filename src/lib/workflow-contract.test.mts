import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowSource = readFileSync(new URL("./workflow.ts", import.meta.url), "utf-8");
const contextSource = readFileSync(new URL("./agents/context.ts", import.meta.url), "utf-8");
const llmSource = readFileSync(new URL("./llm.ts", import.meta.url), "utf-8");
const modelRoutingSource = readFileSync(new URL("./model-routing.ts", import.meta.url), "utf-8");
const roundtableRouteSource = readFileSync(new URL("../app/api/roundtable/route.ts", import.meta.url), "utf-8");

test("workflow exposes the five PLAN phases in order", () => {
  const expected = ["conception", "bible", "structure", "scriptment", "expansion"];
  let last = -1;
  for (const phase of expected) {
    const idx = workflowSource.indexOf(`key: "${phase}"`);
    assert.ok(idx > last, `${phase} should appear after previous phase`);
    last = idx;
  }
  assert.equal(workflowSource.includes('key: "draft"'), false);
  assert.equal(workflowSource.includes('key: "review"'), false);
  assert.equal(workflowSource.includes('key: "final"'), false);
});

test("workflow hard-codes roundtable separation and phase-specific protocols", () => {
  assert.match(workflowSource, /讨论和写作必须严格分离/);
  assert.match(workflowSource, /圆桌事实锚定协议/);
  assert.match(workflowSource, /禁止输出：宏大抽象、创作理念空话/);
  assert.match(workflowSource, /信息经济检测/);
  assert.match(workflowSource, /场景功能检查/);
  assert.match(workflowSource, /跨场景重复扫描/);
  assert.match(workflowSource, /写作单位是章，不是 beat/);
  assert.match(workflowSource, /最多 3 轮/);
});

test("legacy phases normalize into expansion", () => {
  assert.match(workflowSource, /phase === "draft"/);
  assert.match(workflowSource, /phase === "review"/);
  assert.match(workflowSource, /phase === "revision"/);
  assert.match(workflowSource, /phase === "final"/);
  assert.match(workflowSource, /return "expansion"/);
});

test("roundtable agents receive current phase summaries", () => {
  assert.match(contextSource, /includeCurrentPhase\?: boolean/);
  assert.match(contextSource, /includeCurrentPhase \? currentIdx \+ 1 : currentIdx/);
  assert.match(roundtableRouteSource, /includeCurrentPhase: true/);
  assert.match(roundtableRouteSource, /compact: false/);
});

test("roundtable defaults to grounded interactive discussion", () => {
  assert.match(roundtableRouteSource, /generateSummary = false/);
  assert.match(roundtableRouteSource, /isDirectContextQuestion/);
  assert.match(roundtableRouteSource, /effectiveMaxRounds = directContextQuestion \? 1 : maxRounds/);
  assert.match(roundtableRouteSource, /GROUNDED_ROUNDTABLE_PROTOCOL/);
  assert.match(roundtableRouteSource, /humanInterjection/);
  assert.match(roundtableRouteSource, /human_done/);
  assert.match(roundtableRouteSource, /heartbeat/);
  assert.match(roundtableRouteSource, /agent_timeout/);
  assert.match(roundtableRouteSource, /fallback: false/);
  assert.match(roundtableRouteSource, /completeWithTimedFallback/);
  assert.match(roundtableRouteSource, /\[primaryProvider, "gpt", "local"\]/);
});

test("model routing defaults match product expectations", () => {
  assert.match(llmSource, /local/);
  assert.match(llmSource, /LOCAL_LLM_BASE_URL/);
  assert.match(llmSource, /FALLBACK_CHAIN: ModelProvider\[\] = \["gpt", "local"\]/);
  assert.match(modelRoutingSource, /ideaProvider: "gpt"/);
  assert.match(modelRoutingSource, /structureProvider: "claude-code"/);
  assert.match(modelRoutingSource, /reviewProvider: "gemini"/);
  assert.match(modelRoutingSource, /chineseWritingProvider: "deepseek"/);
  assert.match(modelRoutingSource, /englishWritingProvider: "gpt"/);
  assert.match(roundtableRouteSource, /routeProviderForRole\(role, provider, providerSettings, writingLanguage\)/);
});
