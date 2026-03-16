"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Types
interface Beat {
  id: string;
  chapter: string;
  title: string;
  summary: string;
  key: boolean;
  wordBudget: number;
  status: "blank" | "writing" | "review" | "revising" | "done";
  wordCount?: number;
}

interface DraftWorkspaceProps {
  slug: string;
  activeProvider: string;
}

// Beat status display
const STATUS_LABEL: Record<string, { icon: string; color: string; text: string }> = {
  blank: { icon: "○", color: "text-white/25", text: "待写" },
  writing: { icon: "◐", color: "text-amber-400", text: "初稿" },
  review: { icon: "◑", color: "text-sky-400", text: "审稿" },
  revising: { icon: "◕", color: "text-orange-400", text: "修改" },
  done: { icon: "●", color: "text-emerald-400", text: "完成" },
};

export default function DraftWorkspace({ slug, activeProvider }: DraftWorkspaceProps) {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState(""); // current beat's draft text
  const [isChapterView, setIsChapterView] = useState(false); // true when viewing chapter-level draft
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingRole, setStreamingRole] = useState("");
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [userFeedback, setUserFeedback] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"idle" | "writing" | "reviewing" | "revising" | "roundtable">("idle");
  const [editorReview, setEditorReview] = useState(""); // latest editor review text
  const [revisionRound, setRevisionRound] = useState(0);
  const [beatSummaries, setBeatSummaries] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load beats on mount
  useEffect(() => {
    fetch(`/api/beats?projectSlug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(data => {
        if (data.beats) setBeats(data.beats);
      })
      .catch(err => console.error("beats load error:", err));
  }, [slug]);

  // Load beat summaries
  useEffect(() => {
    beats.filter(b => b.status === "done").forEach(b => {
      fetch(`/api/beat-summary?projectSlug=${encodeURIComponent(slug)}&beatId=${encodeURIComponent(b.id)}`)
        .then(r => r.json())
        .then(data => {
          if (data.summary) {
            setBeatSummaries(prev => ({ ...prev, [b.id]: data.summary }));
          }
        })
        .catch(() => {});
    });
  }, [beats, slug]);

  const currentBeat = beats.find(b => b.id === currentBeatId);

  // Get the next unwritten beat
  function getNextBeat(): Beat | undefined {
    return beats.find(b => b.status === "blank" || b.status === "writing");
  }

  // Stream one agent call, returns the full text
  async function streamAgent(role: string, message: string, opts?: { cleanContext?: boolean; skillGroup?: string }): Promise<string> {
    setStreamingRole(role);
    setStreamText("");
    setThinkingSeconds(0);

    const controller = new AbortController();
    abortRef.current = controller;

    const thinkingTimer = setInterval(() => {
      setThinkingSeconds(s => s + 1);
    }, 1000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug: slug,
          role,
          message,
          provider: activeProvider,
          skipSaveHuman: true,
          skipSaveAgent: true,
          cleanContext: opts?.cleanContext ?? true,
          ...(opts?.skillGroup ? { skillGroup: opts.skillGroup } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API错误 (${res.status}): ${errText}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        let lastDataAt = Date.now();
        const STREAM_TIMEOUT = 2 * 60 * 1000;
        const timeoutCheck = setInterval(() => {
          console.log("[TIMEOUT-CHECK] interval fired, idle:", Math.round((Date.now() - lastDataAt) / 1000), "s");
          if (Date.now() - lastDataAt > STREAM_TIMEOUT) {
            clearInterval(timeoutCheck);
            console.log("[TIMEOUT-CHECK] ABORTING — no data for", STREAM_TIMEOUT / 1000, "s");
            controller.abort();
          }
        }, 5000);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lastDataAt = Date.now();
            const chunk = decoder.decode(value);
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.error) throw new Error(parsed.error);
                  if (parsed.text) {
                    fullText += parsed.text;
                    setStreamText(fullText);
                  }
                } catch (parseErr) {
                  if (parseErr instanceof Error && parseErr.message && !parseErr.message.includes("JSON")) {
                    throw parseErr;
                  }
                }
              }
            }
          }
        } catch (readErr) {
          if (controller.signal.aborted) {
            reader.cancel().catch(() => {});
            return fullText;
          }
          throw readErr;
        } finally {
          clearInterval(timeoutCheck);
        }
      }

      return fullText;
    } catch (err) {
      if (controller.signal.aborted) return "";
      throw err;
    } finally {
      clearInterval(thinkingTimer);
      abortRef.current = null;
    }
  }

  // Build the structured prompt for writer
  function buildWriterPrompt(beat: Beat, userInstruction?: string): string {
    const beatIndex = beats.findIndex(b => b.id === beat.id);
    const priorSummaries = beats
      .slice(0, beatIndex)
      .filter(b => beatSummaries[b.id])
      .map(b => beatSummaries[b.id])
      .join("\n\n");

    const chapterBeats = beats.filter(b => b.chapter === beat.chapter);
    const beatListStr = chapterBeats
      .map(b => `[${STATUS_LABEL[b.status].text}] ${b.id}: ${b.title} — ${b.summary}`)
      .join("\n");

    let prompt = `# 写作任务

## 你要写的beat
- **ID**: ${beat.id}
- **标题**: ${beat.title}
- **内容**: ${beat.summary}
- **目标字数**: ${beat.wordBudget}字

## 本章所有beat
${beatListStr}

`;

    if (priorSummaries) {
      prompt += `## 故事到此为止（前情摘要）

${priorSummaries}

`;
    }

    if (userInstruction) {
      prompt += `## 创作者指令（优先级最高）

${userInstruction}

`;
    }

    prompt += `## 要求
1. 只写这一个beat，不要写前后的内容
2. 目标${beat.wordBudget}字左右，不要太长也不要太短
3. 衔接好上文的语感和节奏
4. 直接输出正文，不要加标题、不要加解释`;

    return prompt;
  }

  // Build editor prompt
  function buildEditorPrompt(beat: Beat, writerOutput: string): string {
    return `# 审稿任务

## beat要求
- **ID**: ${beat.id}
- **标题**: ${beat.title}
- **内容要求**: ${beat.summary}
- **目标字数**: ${beat.wordBudget}字

## 待审稿件

${writerOutput}

## 审稿规则
1. 先列出【守住清单】——写得好的段落/句子，改稿时不可删改
2. 再列问题（按P0/P1/P2分级）
3. 如果稿件质量达标（无P0问题，P1问题可接受），在回复最后单独一行写 [APPROVED]
4. 不要自己改写，只提意见`;
  }

  // Build revision prompt
  function buildRevisionPrompt(writerOutput: string, editorReviewText: string, userNotes?: string): string {
    let prompt = `请根据以下审稿意见修改稿件。

⚠️ 改稿铁律：
1. 【守住清单】里的内容一字不动
2. 只改铁面明确指出的问题，不要动其他地方
3. 修改方向是写得更好，不是写得更短更安全
4. 禁止把长句拆成碎片短句，禁止删掉具体意象换成概括
5. 改完的稿件不应比原稿短超过10%

输出修改后的完整文本。

---

## 原稿

${writerOutput}

---

## 审稿意见

${editorReviewText}`;

    if (userNotes) {
      prompt += `

---

## 创作者意见（优先级最高）

${userNotes}`;
    }

    return prompt;
  }

  // === Main workflow actions ===

  async function startWriting(beat: Beat, instruction?: string) {
    if (streaming) return;
    setCurrentBeatId(beat.id);
    setMode("writing");
    setStreaming(true);
    setError("");
    setDraftContent("");
    setEditorReview("");
    setRevisionRound(0);
    setIsChapterView(false);

    try {
      const prompt = buildWriterPrompt(beat, instruction);
      const text = await streamAgent("writer", prompt, { cleanContext: true, skillGroup: "drafting" });
      const cleanText = text.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      setDraftContent(cleanText);
      setStreamText("");
      setMode("idle");
      updateBeatStatus(beat.id, "writing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "写作失败");
      setMode("idle");
    } finally {
      setStreaming(false);
    }
  }

  async function sendToReview() {
    if (streaming || !currentBeat || !draftContent) return;
    setMode("reviewing");
    setStreaming(true);
    setError("");

    try {
      const prompt = buildEditorPrompt(currentBeat, draftContent);
      const text = await streamAgent("editor", prompt, { cleanContext: true, skillGroup: "editing" });
      const cleanText = text.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      const approved = text.includes("[APPROVED]");
      setEditorReview(cleanText);
      setStreamText("");

      if (approved) {
        await approveBeat();
      } else {
        setMode("idle");
        updateBeatStatus(currentBeat.id, "review");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "审稿失败");
      setMode("idle");
    } finally {
      setStreaming(false);
    }
  }

  async function revise(userNotes?: string) {
    if (streaming || !currentBeat || !draftContent) return;
    if (revisionRound >= 3) {
      setError("已达到最大修改轮数。请选择接受当前版本或手动编辑。");
      return;
    }
    setMode("revising");
    setStreaming(true);
    setError("");
    setRevisionRound(r => r + 1);

    try {
      const prompt = buildRevisionPrompt(draftContent, editorReview, userNotes);
      const text = await streamAgent("writer", prompt, { cleanContext: true, skillGroup: "revision" });
      const cleanText = text.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      setDraftContent(cleanText);
      setStreamText("");

      // Auto-send back to editor
      setMode("reviewing");
      const reviewPrompt = buildEditorPrompt(currentBeat, cleanText);
      const reviewText = await streamAgent("editor", reviewPrompt, { cleanContext: true, skillGroup: "editing" });
      const reviewClean = reviewText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      const approved = reviewText.includes("[APPROVED]");
      setEditorReview(reviewClean);
      setStreamText("");

      if (approved) {
        await approveBeat();
      } else {
        setMode("idle");
        updateBeatStatus(currentBeat.id, "revising");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
      setMode("idle");
    } finally {
      setStreaming(false);
    }
  }

  const [approving, setApproving] = useState(false);

  async function approveBeat() {
    if (!currentBeat || !draftContent || approving) return;
    setApproving(true);
    setError("");

    try {
      // 1. Save draft file
      const saveRes = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, sectionId: currentBeat.id, content: draftContent }),
      });
      if (!saveRes.ok) {
        throw new Error(`保存失败 (${saveRes.status})`);
      }

      // 2. Update status immediately so user sees feedback
      updateBeatStatus(currentBeat.id, "done");
      setMode("idle");
      setEditorReview("");

      // 3. Move to next beat
      const idx = beats.findIndex(b => b.id === currentBeat.id);
      const nextBeat = beats[idx + 1];
      if (nextBeat && nextBeat.status === "blank") {
        setCurrentBeatId(nextBeat.id);
        setDraftContent("");
        setIsChapterView(false);
      }

      // 4. Generate summary in background (non-blocking)
      const beatId = currentBeat.id;
      fetch("/api/beat-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, beatId, provider: "gemini" }),
      }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.summary) {
            setBeatSummaries(prev => ({ ...prev, [beatId]: data.summary }));
          }
        }
      }).catch(() => {}); // summary failure is non-critical
    } catch (err) {
      setError(err instanceof Error ? err.message : "采纳失败");
    } finally {
      setApproving(false);
    }
  }

  async function updateBeatStatus(beatId: string, status: Beat["status"]) {
    setBeats(prev => prev.map(b => b.id === beatId ? { ...b, status } : b));
    await fetch("/api/beats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, beatId, updates: { status } }),
    }).catch(() => {});
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  // Load existing draft content for a beat (from beat file or chapter file)
  const loadDraftContent = useCallback(async (beatId: string) => {
    try {
      const res = await fetch(`/api/drafts?projectSlug=${encodeURIComponent(slug)}&sectionId=${encodeURIComponent(beatId)}`);
      const data = await res.json();
      if (data.content) {
        setDraftContent(data.content);
        setIsChapterView(!!data.isChapter);
      } else {
        setDraftContent("");
        setIsChapterView(false);
      }
    } catch {
      setDraftContent("");
      setIsChapterView(false);
    }
  }, [slug]);

  // Group beats by chapter for sidebar display
  const chapters = beats.reduce<Record<string, Beat[]>>((acc, beat) => {
    if (!acc[beat.chapter]) acc[beat.chapter] = [];
    acc[beat.chapter].push(beat);
    return acc;
  }, {});

  const totalDone = beats.filter(b => b.status === "done").length;
  const totalChars = beats.reduce((sum, b) => sum + (b.wordCount || 0), 0);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left sidebar: progress */}
      <div className="w-96 shrink-0 border-r border-white/10 overflow-y-auto p-4 text-sm">
        {/* Progress overview */}
        <div className="mb-4 px-1">
          <div className="flex items-center justify-between text-white/60 mb-1.5">
            <span className="font-medium">写作进度</span>
            <span>{totalDone}/{beats.length} beats</span>
          </div>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-1.5">
            <div
              className="h-full bg-emerald-500/60 rounded-full transition-all"
              style={{ width: `${beats.length ? (totalDone / beats.length) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-white/30 text-xs">
            <span>{totalChars.toLocaleString()}字</span>
            <span>{Math.round(beats.length ? (totalDone / beats.length) * 100 : 0)}%</span>
          </div>
        </div>

        {Object.entries(chapters).map(([chapter, chapterBeats]) => {
          const chapterDone = chapterBeats.filter(b => b.status === "done").length;
          return (
          <div key={chapter} className="mb-3">
            <div className="flex items-center justify-between text-white/70 font-medium mb-1 px-1">
              <span>{chapter}</span>
              {chapterDone > 0 && (
                <span className="text-white/30 text-xs">{chapterDone}/{chapterBeats.length}</span>
              )}
            </div>
            {chapterBeats.map(beat => {
              const st = STATUS_LABEL[beat.status];
              return (
              <button
                key={beat.id}
                onClick={() => {
                  setCurrentBeatId(beat.id);
                  setMode("idle");
                  setEditorReview("");
                  setIsChapterView(false);
                  if (beat.status === "done") {
                    setDraftContent("");
                    loadDraftContent(beat.id);
                  } else {
                    setDraftContent("");
                  }
                }}
                className={`block w-full text-left px-2 py-1.5 rounded text-xs ${
                  currentBeatId === beat.id ? "bg-white/10" : "hover:bg-white/5"
                } ${beat.key ? "border-l-2 border-amber-400/50" : ""}`}
              >
                <span className={`mr-1.5 ${st.color}`}>{st.icon}</span>
                <span className={beat.status === "done" ? "text-white/40" : "text-white/80"}>
                  {beat.title}
                </span>
                {beat.wordCount ? (
                  <span className="text-white/30 ml-1">({beat.wordCount.toLocaleString()}字)</span>
                ) : null}
              </button>
              );
            })}
          </div>
          );
        })}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!currentBeat ? (
          <div className="flex-1 flex items-center justify-center text-white/30">
            <div className="text-center">
              <p className="text-lg mb-4">选择一个beat开始写作</p>
              {getNextBeat() && (
                <button
                  onClick={() => setCurrentBeatId(getNextBeat()!.id)}
                  className="px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 rounded text-emerald-300"
                >
                  从 {getNextBeat()!.id} 开始
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Beat header */}
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="text-lg">{STATUS_LABEL[currentBeat.status].icon}</span>
                <div>
                  <h2 className="text-white/90 font-medium">{currentBeat.id} — {currentBeat.title}</h2>
                  <p className="text-white/40 text-sm">{currentBeat.summary}</p>
                </div>
                {currentBeat.key && (
                  <span className="text-amber-400/70 text-xs border border-amber-400/30 rounded px-2 py-0.5">关键情节</span>
                )}
                <span className="text-white/30 text-xs ml-auto">目标 {currentBeat.wordBudget}字</span>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Empty state — no draft yet */}
              {!streaming && !draftContent && !editorReview && !error && currentBeat.status !== "done" && (
                <div className="flex-1 flex items-center justify-center h-full text-white/20">
                  <div className="text-center">
                    <div className="text-4xl mb-3 opacity-40">✍</div>
                    <p className="text-sm">在下方输入写作指令，或直接点"开始写"</p>
                    <p className="text-xs mt-1 text-white/15">目标 {currentBeat.wordBudget} 字 · {currentBeat.key ? "关键情节" : "过渡段落"}</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded text-red-300 text-sm flex items-center justify-between">
                  <span>⚠️ {error}</span>
                  <div className="flex gap-2">
                    <button onClick={() => { setError(""); startWriting(currentBeat); }} className="text-xs px-2 py-1 bg-red-800/50 rounded hover:bg-red-800/70">重试</button>
                    <button onClick={() => setError("")} className="text-xs px-2 py-1 bg-white/10 rounded hover:bg-white/20">关闭</button>
                  </div>
                </div>
              )}

              {streaming && (
                <div className="mb-3 flex items-center gap-2 text-white/40 text-sm">
                  <span className="animate-pulse">●</span>
                  <span>
                    {streamingRole === "writer" ? "✍ 妙笔" : streamingRole === "editor" ? "📝 铁面" : streamingRole}
                    {mode === "writing" ? "写作中" : mode === "reviewing" ? "审稿中" : mode === "revising" ? "修改中" : "思考中"}
                    ... {thinkingSeconds}s
                  </span>
                  <button onClick={stopStreaming} className="text-xs px-2 py-0.5 bg-white/10 rounded hover:bg-white/20">停止</button>
                </div>
              )}

              {streaming && streamText && (
                <div className="mb-4 p-4 bg-white/5 rounded border border-white/10 text-white/80 whitespace-pre-wrap text-sm leading-relaxed">
                  {streamText}
                </div>
              )}

              {!streaming && draftContent && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2 text-white/40 text-xs">
                    {isChapterView ? (
                      <span>📖 {currentBeat.chapter} 全章 · {draftContent.length}字（已审稿通过）</span>
                    ) : (
                      <>
                        <span>✍ 妙笔 · {draftContent.length}字</span>
                        {revisionRound > 0 && <span>· 第{revisionRound}轮修改</span>}
                      </>
                    )}
                  </div>
                  <div className="p-4 bg-white/5 rounded border border-white/10 text-white/80 whitespace-pre-wrap text-sm leading-relaxed">
                    {draftContent}
                  </div>
                </div>
              )}

              {!streaming && editorReview && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2 text-white/40 text-xs">
                    <span>📝 铁面审稿意见</span>
                  </div>
                  <div className="p-4 bg-sky-950/30 rounded border border-sky-500/20 text-white/70 whitespace-pre-wrap text-sm leading-relaxed">
                    {editorReview}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Action bar */}
            {!streaming && (
              <div className="p-4 border-t border-white/10">
                {!draftContent && currentBeat.status !== "done" && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={userFeedback}
                      onChange={e => setUserFeedback(e.target.value)}
                      placeholder="写作指令（可选）：语气、节奏、重点..."
                      className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder-white/30 focus:outline-none focus:border-white/20"
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          startWriting(currentBeat, userFeedback || undefined);
                          setUserFeedback("");
                        }
                      }}
                    />
                    <button
                      onClick={() => { startWriting(currentBeat, userFeedback || undefined); setUserFeedback(""); }}
                      className="px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 rounded text-emerald-300 text-sm"
                    >
                      {currentBeat.key ? "🔑 先讨论再写" : "开始写"}
                    </button>
                  </div>
                )}

                {draftContent && !editorReview && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={userFeedback}
                      onChange={e => setUserFeedback(e.target.value)}
                      placeholder="给意见让妙笔改..."
                      className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder-white/30 focus:outline-none focus:border-white/20"
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (userFeedback.trim()) {
                            startWriting(currentBeat, userFeedback);
                            setUserFeedback("");
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (userFeedback.trim()) {
                          startWriting(currentBeat, userFeedback);
                          setUserFeedback("");
                        }
                      }}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded text-white/60 text-sm"
                      disabled={!userFeedback.trim()}
                    >
                      ✎ 给意见
                    </button>
                    <button
                      onClick={sendToReview}
                      className="px-3 py-2 bg-sky-600/30 hover:bg-sky-600/50 rounded text-sky-300 text-sm"
                    >
                      📝 送审
                    </button>
                    <button
                      onClick={approveBeat}
                      disabled={approving}
                      className="px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 disabled:opacity-40 rounded text-emerald-300 text-sm"
                    >
                      {approving ? "保存中..." : "✓ 直接通过"}
                    </button>
                  </div>
                )}

                {draftContent && editorReview && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={userFeedback}
                      onChange={e => setUserFeedback(e.target.value)}
                      placeholder="补充你的意见（和铁面的一起给妙笔）..."
                      className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder-white/30 focus:outline-none focus:border-white/20"
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          revise(userFeedback || undefined);
                          setUserFeedback("");
                        }
                      }}
                    />
                    <button
                      onClick={() => { revise(userFeedback || undefined); setUserFeedback(""); }}
                      className="px-3 py-2 bg-amber-600/30 hover:bg-amber-600/50 rounded text-amber-300 text-sm"
                    >
                      🔄 按意见改 {revisionRound > 0 ? `(${revisionRound}/3)` : ""}
                    </button>
                    <button
                      onClick={approveBeat}
                      disabled={approving}
                      className="px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 disabled:opacity-40 rounded text-emerald-300 text-sm"
                    >
                      {approving ? "保存中..." : "✓ 不改了，通过"}
                    </button>
                  </div>
                )}

                {currentBeat.status === "done" && !draftContent && (
                  <div className="flex gap-2 items-center text-white/40 text-sm">
                    <span>✅ 这个beat已经完成了</span>
                    <button
                      onClick={() => startWriting(currentBeat)}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded text-white/60 text-sm"
                    >
                      重写
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
