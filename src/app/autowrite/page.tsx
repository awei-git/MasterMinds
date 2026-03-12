"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

type AgentKey = "angle" | "structure" | "draft" | "edit" | "revise" | "reflect" | "reader";

interface AgentBlock {
  key: AgentKey;
  label: string;
  text: string;
  round?: number;
  done: boolean;
}

interface UploadedFile {
  name: string;
  content: string;
}

const AGENT_COLORS: Record<AgentKey, string> = {
  angle:     "text-amber-400",
  structure: "text-blue-400",
  draft:     "text-emerald-400",
  edit:      "text-red-400",
  revise:    "text-emerald-300",
  reflect:   "text-purple-400",
  reader:    "text-cyan-400",
};

const AGENT_BG: Record<AgentKey, string> = {
  angle:     "border-amber-400/30 bg-amber-400/5",
  structure: "border-blue-400/30 bg-blue-400/5",
  draft:     "border-emerald-400/30 bg-emerald-400/5",
  edit:      "border-red-400/30 bg-red-400/5",
  revise:    "border-emerald-300/30 bg-emerald-300/5",
  reflect:   "border-purple-400/30 bg-purple-400/5",
  reader:    "border-cyan-400/30 bg-cyan-400/5",
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string ?? "");
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

export default function AutoWritePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [maxRounds, setMaxRounds] = useState(2);
  const [provider, setProvider] = useState("claude-code");
  const [running, setRunning] = useState(false);
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [finalResult, setFinalResult] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks]);

  // Combine all file contents + notes into one material string
  const buildMaterial = useCallback(() => {
    const parts: string[] = [];
    for (const f of files) {
      parts.push(`=== ${f.name} ===\n${f.content}`);
    }
    if (notes.trim()) parts.push(`=== 备注/指令 ===\n${notes.trim()}`);
    return parts.join("\n\n");
  }, [files, notes]);

  const hasContent = files.length > 0 || notes.trim().length > 0;

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    const loaded = await Promise.all(
      incoming.map(async (f) => ({
        name: f.name,
        content: await readFileAsText(f),
      }))
    );
    setFiles((prev) => {
      // Deduplicate by name
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...loaded.filter((f) => !names.has(f.name))];
    });
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  }

  function addOrUpdateBlock(
    key: AgentKey,
    label: string,
    textDelta: string,
    done: boolean,
    round?: number
  ) {
    setBlocks((prev) => {
      const idx = prev.findLastIndex(
        (b) => b.key === key && (round === undefined || b.round === round)
      );
      if (idx === -1) {
        return [...prev, { key, label, text: textDelta, done, round }];
      }
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        text: updated[idx].text + textDelta,
        done,
        label: label || updated[idx].label,
      };
      return updated;
    });
  }

  async function run() {
    if (!hasContent || running) return;
    setRunning(true);
    setBlocks([]);
    setFinalResult("");
    setError("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/autowrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material: buildMaterial(), provider, maxRounds }),
        signal: ctrl.signal,
      });

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(part.slice(6));
            if (ev.error) { setError(ev.error); break; }
            if (ev.done) { setFinalResult(ev.result ?? ""); break; }
            if (ev.stage === "start") {
              addOrUpdateBlock(ev.agent, ev.label, "", false, ev.round);
            } else if (ev.stage === "text") {
              addOrUpdateBlock(ev.agent, "", ev.text, false, ev.round);
            } else if (ev.stage === "done" || ev.stage === "passed") {
              addOrUpdateBlock(ev.agent, "", "", true, ev.round);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  function copy() {
    navigator.clipboard.writeText(finalResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-muted/60 hover:text-muted text-sm transition-colors">← 项目</Link>
        <h1 className="font-semibold text-lg">AutoWrite · 一键成稿</h1>
        <span className="text-xs text-muted/40 ml-auto">灵犀 → 鲁班 → 妙笔 ↔ 铁面 → 知音</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Input panel */}
        <div className="w-80 border-r border-border/50 flex flex-col p-4 gap-3 shrink-0 overflow-y-auto">

          {/* Drop zone */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted/60">原始材料</label>
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => !running && fileInputRef.current?.click()}
              className={`
                relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                ${dragging
                  ? "border-accent/60 bg-accent/10"
                  : "border-border/40 hover:border-border-light/60 bg-surface/40 hover:bg-surface/60"
                }
                ${running ? "cursor-not-allowed opacity-50" : ""}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.csv,.json,.xml,.html,.js,.ts,.py,.rst,.tex"
                className="hidden"
                disabled={running}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
              <div className="text-2xl mb-1.5">📄</div>
              <div className="text-xs text-muted/60">
                拖拽文件到这里，或点击选择
              </div>
              <div className="text-xs text-muted/30 mt-1">
                支持 .txt .md .json 等文本格式
              </div>
            </div>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="flex flex-col gap-1">
              {files.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface/60 border border-border/40 group"
                >
                  <span className="text-xs text-muted/50 shrink-0">📄</span>
                  <span className="text-xs text-foreground/70 flex-1 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="text-xs text-muted/30 shrink-0">
                    {f.content.length > 1000
                      ? `${(f.content.length / 1000).toFixed(1)}k`
                      : `${f.content.length}字`}
                  </span>
                  {!running && (
                    <button
                      onClick={() => removeFile(f.name)}
                      className="text-muted/30 hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setFiles([])}
                disabled={running}
                className="text-xs text-muted/30 hover:text-muted/60 text-right transition-colors disabled:cursor-not-allowed"
              >
                清空全部
              </button>
            </div>
          )}

          {/* Notes textarea */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted/60">备注 / 额外指令（可选）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="写作方向、风格要求、不想要的内容..."
              className="h-24 resize-none bg-surface/60 border border-border/60 rounded-lg p-3 text-sm outline-none focus:border-accent/50 transition-colors placeholder:text-muted/30"
              disabled={running}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs text-muted/60">模型</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="bg-surface/60 border border-border/60 rounded-lg px-2.5 py-1.5 text-sm outline-none"
                disabled={running}
              >
                <option value="claude-code">Claude Max</option>
                <option value="claude">Claude API</option>
                <option value="deepseek">DeepSeek</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted/60">迭代轮数</label>
              <select
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value))}
                className="bg-surface/60 border border-border/60 rounded-lg px-2.5 py-1.5 text-sm outline-none"
                disabled={running}
              >
                <option value={1}>1轮</option>
                <option value={2}>2轮</option>
                <option value={3}>3轮</option>
                <option value={4}>4轮</option>
              </select>
            </div>
          </div>

          {running ? (
            <button
              onClick={stop}
              className="w-full py-2.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-sm hover:bg-red-500/30 transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              onClick={run}
              disabled={!hasContent}
              className="w-full py-2.5 rounded-lg bg-accent/20 text-accent border border-accent/30 text-sm hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              开始创作
            </button>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
              {error}
            </div>
          )}

          {/* Pipeline legend */}
          <div className="mt-auto pt-4 border-t border-border/30 flex flex-col gap-1.5">
            <span className="text-xs text-muted/40 mb-1">流水线</span>
            {(["angle","structure","draft","edit","revise","reflect","reader"] as AgentKey[]).map((k) => (
              <div key={k} className={`text-xs px-2 py-1 rounded border ${AGENT_BG[k]} ${AGENT_COLORS[k]}`}>
                {k === "angle" && "灵犀 · 找角度"}
                {k === "structure" && "鲁班 · 定结构"}
                {k === "draft" && "妙笔 · 写稿"}
                {k === "edit" && "铁面 · 审稿"}
                {k === "revise" && "妙笔 · 修改"}
                {k === "reflect" && "铁面 · 反思"}
                {k === "reader" && "知音 · 评估"}
              </div>
            ))}
            <div className="text-xs text-muted/30 mt-1">铁面 ↔ 妙笔 循环至 PASS → 知音评估</div>
          </div>
        </div>

        {/* Right: Output panel */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {blocks.length === 0 && !running && !finalResult && (
            <div className="flex-1 flex items-center justify-center text-muted/30 text-sm">
              拖入文件或输入备注，点「开始创作」
            </div>
          )}

          {blocks.map((block, i) => (
            <div key={i} className={`rounded-lg border p-4 ${AGENT_BG[block.key]}`}>
              <div className={`text-xs font-medium mb-2 flex items-center gap-2 ${AGENT_COLORS[block.key]}`}>
                <span>{block.label}</span>
                {!block.done && running && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                )}
                {block.done && <span className="opacity-50">✓</span>}
              </div>
              <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed font-mono text-xs">
                {block.text || (running && !block.done ? "…" : "")}
              </div>
            </div>
          ))}

          {finalResult && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-accent text-sm font-medium">成稿</span>
                <button
                  onClick={copy}
                  className="text-xs text-muted/60 hover:text-muted px-2.5 py-1 rounded border border-border/40 transition-colors"
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <div className="whitespace-pre-wrap prose-paper">
                {finalResult}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
