import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowSource = readFileSync(new URL("./workflow.ts", import.meta.url), "utf-8");
const contextSource = readFileSync(new URL("./agents/context.ts", import.meta.url), "utf-8");
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
