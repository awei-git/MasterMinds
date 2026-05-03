"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DraftWorkspace from "./DraftWorkspace";

interface Message {
  id: string;
  role: string;
  model?: string;
  phase?: string;
  content: string;
  createdAt: string;
  intermediate?: boolean; // collapsed intermediate draft/review rounds
}

interface Round {
  id: string; // first message id
  humanMsg: Message | null;
  agentMsgs: Message[];
  phase?: string;
  timestamp: string;
}

interface Clip {
  id: string;
  content: string;
  source: string | null;
  createdAt: string;
}

// Creative names — shown when agents speak in chat
const ROLE_META: Record<string, { label: string; category: string; color: string; icon: string }> = {
  human: { label: "你", category: "你", color: "text-foreground/70", icon: "" },
  idea: { label: "灵犀", category: "点子", color: "text-teal-300/90", icon: "💡" },
  architect: { label: "鲁班", category: "结构", color: "text-cyan-300/80", icon: "🏗" },
  character: { label: "画皮", category: "角色", color: "text-slate-300", icon: "🎭" },
  writer: { label: "妙笔", category: "写手", color: "text-emerald-300/80", icon: "✍" },
  editor: { label: "铁面", category: "编辑", color: "text-sky-300/80", icon: "📝" },
  reader: { label: "知音", category: "读者", color: "text-zinc-400", icon: "📖" },
  continuity: { label: "掌故", category: "连续性", color: "text-slate-400", icon: "🔗" },
  chronicler: { label: "史官", category: "记录", color: "text-amber-200/70", icon: "📜" },
  reviewer: { label: "评审", category: "评审", color: "text-rose-300/80", icon: "🔍" },
  context: { label: "参考资料", category: "导入", color: "text-amber-300/60", icon: "📄" },
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  gpt: "GPT",
  deepseek: "DeepSeek",
  gemini: "Gemini",
};

const FLOW_STEPS = [
  { key: "conception", label: "构思", agent: "idea", description: "打磨核心创意：冲突、主题、logline" },
  { key: "bible", label: "世界与角色", agent: "character", description: "建立角色档案、世界观、规则" },
  { key: "structure", label: "结构", agent: "architect", description: "节拍表、章节大纲、张力曲线" },
  { key: "scriptment", label: "全文速写", agent: "writer", description: "25-30%压缩叙事，结构审稿" },
  { key: "expansion", label: "逐章扩写", agent: "writer", description: "逐章 briefing、写作、审稿、修改闭环" },
];

// Which agents sit at the table for each phase
const PHASE_PANEL: Record<string, string[]> = {
  conception: ["idea", "architect", "character"],
  bible: ["character", "idea", "architect"],
  structure: ["architect", "editor", "reader"],
  scriptment: ["editor", "reader", "architect"],
  expansion: ["character", "architect", "editor"],
  draft: ["character", "architect", "editor"],
  review: ["character", "architect", "editor"],
  final: ["character", "architect", "editor"],
};

const WELCOME_PROMPTS = [
  "我有一个关于……的故事想法",
  "我想写一个发生在……的故事",
  "我对……这个主题很感兴趣",
];

function normalizePhaseKey(phase?: string) {
  if (phase === "draft" || phase === "review" || phase === "revision" || phase === "final") return "expansion";
  return phase || "conception";
}

export default function ProjectPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>();
  const slug = decodeURIComponent(rawSlug);
  const [projectTitle, setProjectTitle] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingRole, setStreamingRole] = useState("");
  const [streamText, setStreamText] = useState("");
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [error, setError] = useState("");
  // activeRole is unused — roundtable mode uses PHASE_PANEL instead
  const [activeProvider, setActiveProvider] = useState("claude-code");
  const [currentPhase, setCurrentPhase] = useState("conception");
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipInput, setClipInput] = useState("");
  const [clipSearch, setClipSearch] = useState("");
  const [clippedId, setClippedId] = useState<string | null>(null);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showPhasePrompt, setShowPhasePrompt] = useState(false);
  const [phaseSummaries, setPhaseSummaries] = useState<Record<string, string>>({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [writingTaskLoading, setWritingTaskLoading] = useState<string | null>(null);
  const [summaryModal, setSummaryModal] = useState<{ phase: string; text: string; editing: boolean } | null>(null);
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set());
  const [roundSummaries, setRoundSummaries] = useState<Record<string, string>>({});
  // Writer pause: after each 300-500 word chunk in draft phase, stop and wait for human decision
  const [writerPause, setWriterPause] = useState(false);
  const [writerFeedback, setWriterFeedback] = useState("");
  // Revision loop interrupt: allows user to inject feedback mid-loop
  const [revisionPaused, setRevisionPaused] = useState(false);
  const [revisionFeedbackInput, setRevisionFeedbackInput] = useState("");
  const [allProjects, setAllProjects] = useState<{ slug: string; title: string; phase?: string }[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [draggingInput, setDraggingInput] = useState(false);
  // @ mention dropdown
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionStartRef = useRef<number>(-1); // cursor position of the '@'
  const revisionResolveRef = useRef<((feedback: string) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/projects`)
      .then((r) => r.json())
      .then((projects: { slug: string; title: string; phase?: string }[]) => {
        setAllProjects(projects);
        const p = projects.find((p) => p.slug === slug);
        if (p) {
          setProjectTitle(p.title);
          if (p.phase) setCurrentPhase(normalizePhaseKey(p.phase));
        }
      })
      .catch((err) => console.error("projects fetch error:", err));
    fetch(`/api/chat?projectSlug=${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`chat API ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          console.log(`Loaded ${data.length} messages`);
          setMessages(data);
        }
      })
      .catch((err) => {
        console.error("chat fetch error:", err);
        setError(`加载消息失败: ${err.message}`);
      });
    fetch(`/api/clips?projectSlug=${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setClips(data);
      })
      .catch((err) => console.error("clips fetch error:", err));
    // Load existing phase summaries
    for (const step of FLOW_STEPS) {
      fetch(`/api/phases?projectSlug=${encodeURIComponent(slug)}&phase=${step.key}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.content) {
            setPhaseSummaries((prev) => ({ ...prev, [step.key]: data.content }));
          }
        })
        .catch(() => {});
    }
  }, [slug]);

  async function saveClip(content: string, source?: string) {
    const res = await fetch("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, content, source }),
    });
    if (res.ok) {
      const clip = await res.json();
      setClips((prev) => [clip, ...prev]);
    }
  }

  async function deleteClip(id: string) {
    const res = await fetch(`/api/clips?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setClips((prev) => prev.filter((c) => c.id !== id));
    }
  }

  async function clearAllMessages() {
    const res = await fetch(`/api/chat?projectSlug=${encodeURIComponent(slug)}`, { method: "DELETE" });
    if (res.ok) {
      setMessages([]);
      setConfirmClear(false);
      setShowChatMenu(false);
    }
  }

  async function deleteMessage(id: string) {
    const res = await fetch(`/api/chat?messageId=${id}`, { method: "DELETE" });
    if (res.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }
  }

  async function exportMarkdown() {
    const res = await fetch(`/api/chat?projectSlug=${encodeURIComponent(slug)}&format=md`);
    if (!res.ok) return;
    const text = await res.text();
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectTitle || slug}-对话记录.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowChatMenu(false);
  }

  async function importMarkdown(file: File) {
    const content = await file.text();
    const res = await fetch("/api/chat", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: slug,
        content,
        source: file.name.replace(/\.md$/, ""),
      }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
      setShowChatMenu(false);
    }
  }

  async function setPhase(phaseKey: string) {
    await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, action: "setPhase", phase: phaseKey }),
    });
    setCurrentPhase(phaseKey);
  }

  const generatePhaseSummary = useCallback(async (phase: string) => {
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/phases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, phase, provider: activeProvider }),
      });
      if (res.ok) {
        const data = await res.json();
        setPhaseSummaries((prev) => ({ ...prev, [phase]: data.content }));
      } else {
        const data = await res.json().catch(() => ({}));
        console.warn(`Phase summary generation failed for ${phase}:`, data.error || res.statusText);
      }
    } catch (err) {
      console.warn(`Phase summary generation error for ${phase}:`, err);
    } finally {
      setSummaryLoading(false);
    }
  }, [activeProvider, slug]);

  async function savePhaseSummary(phase: string, content: string) {
    await fetch("/api/phases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, phase, content }),
    });
    setPhaseSummaries((prev) => ({ ...prev, [phase]: content }));
  }

  async function runWritingTask(kind: string) {
    if (writingTaskLoading) return;
    setWritingTaskLoading(kind);
    setError("");
    try {
      const res = await fetch("/api/writing-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, kind, provider: activeProvider }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "写作任务失败");
      }
      setMessages((prev) => [...prev, {
        id: `writing-task-${Date.now()}`,
        role: kind.includes("beat") ? "architect" : kind.includes("bible") ? "character" : "writer",
        model: activeProvider,
        phase: currentPhase,
        content: `【独立写作任务：${kind}】\n保存路径：${data.path}\n\n${data.content}`,
        createdAt: new Date().toISOString(),
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "写作任务失败");
    } finally {
      setWritingTaskLoading(null);
    }
  }

  // Open summary modal: generate summary for current phase, then show for review
  async function startPhaseTransition() {
    const phase = currentPhase;
    // If summary already exists, show it directly
    if (phaseSummaries[phase]) {
      setSummaryModal({ phase, text: phaseSummaries[phase], editing: false });
      return;
    }
    // Generate summary
    setSummaryModal({ phase, text: "", editing: false });
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/phases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, phase, provider: activeProvider }),
      });
      if (res.ok) {
        const data = await res.json();
        setPhaseSummaries((prev) => ({ ...prev, [phase]: data.content }));
        setSummaryModal({ phase, text: data.content, editing: false });
      } else {
        const data = await res.json().catch(() => ({}));
        setSummaryModal(null);
        alert(`总结生成失败: ${data.error || res.statusText}`);
      }
    } finally {
      setSummaryLoading(false);
    }
  }

  function confirmAdvancePhase() {
    const idx = FLOW_STEPS.findIndex((s) => s.key === currentPhase);
    if (idx < FLOW_STEPS.length - 1) {
      setPhase(FLOW_STEPS[idx + 1].key);
    }
    setSummaryModal(null);
    setShowPhasePrompt(false);
  }

  // Group messages into rounds: human message + subsequent agent replies
  const rounds: Round[] = useMemo(() => {
    const result: Round[] = [];
    let current: Round | null = null;
    for (const m of messages) {
      if (m.role === "human") {
        if (current) result.push(current);
        current = {
          id: m.id,
          humanMsg: m,
          agentMsgs: [],
          phase: m.phase,
          timestamp: m.createdAt,
        };
      } else if (current) {
        current.agentMsgs.push(m);
        if (!current.phase && m.phase) current.phase = m.phase;
      } else {
        // Agent message before any human message (e.g. context imports)
        result.push({
          id: m.id,
          humanMsg: null,
          agentMsgs: [m],
          phase: m.phase,
          timestamp: m.createdAt,
        });
      }
    }
    if (current) result.push(current);
    return result;
  }, [messages]);

  // Toggle round collapse and generate summary if needed
  async function toggleRound(roundId: string, round: Round) {
    const newCollapsed = new Set(collapsedRounds);
    if (newCollapsed.has(roundId)) {
      newCollapsed.delete(roundId);
    } else {
      newCollapsed.add(roundId);
      // Generate summary if not cached
      if (!roundSummaries[roundId] && round.agentMsgs.length > 0) {
        const allMsgs = [
          ...(round.humanMsg ? [{ role: "human", content: round.humanMsg.content }] : []),
          ...round.agentMsgs.map((m) => ({ role: m.role, content: m.content })),
        ];
        try {
          const res = await fetch("/api/chat/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: allMsgs, provider: activeProvider }),
          });
          if (res.ok) {
            const data = await res.json();
            setRoundSummaries((prev) => ({ ...prev, [roundId]: data.summary }));
          }
        } catch {
          // silent fail — just show without summary
        }
      }
    }
    setCollapsedRounds(newCollapsed);
  }

  // Auto-collapse all rounds except the last two
  useEffect(() => {
    if (rounds.length <= 2) return;
    const toCollapse = new Set<string>();
    for (let i = 0; i < rounds.length - 2; i++) {
      toCollapse.add(rounds[i].id);
    }
    setCollapsedRounds(toCollapse);
  }, [rounds]);

  // During streaming: scroll to bottom. When streaming ends: scroll back to user's message.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (wasStreaming.current) {
      wasStreaming.current = false;
      // Roundtable finished — scroll to user's last message
      setTimeout(() => {
        const humanMsgs = document.querySelectorAll("[data-human-msg]");
        const last = humanMsgs[humanMsgs.length - 1];
        last?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
      // Auto-generate phase summary only for planning phases (not during writing/review/final)
      const skipSummaryPhases = ["expansion", "draft", "review", "final"];
      if (!skipSummaryPhases.includes(currentPhase)) {
        generatePhaseSummary(currentPhase);
      }
    }
  }, [currentPhase, generatePhaseSummary, streaming, streamText]);

  // Stream one agent's response, return the text
  async function streamOneAgent(role: string, message: string, skipSaveHuman = false, skipSaveAgent = false, cleanContext = false, skillGroup?: string): Promise<string> {
    console.log("[STREAM-V2] streamOneAgent called for role:", role);
    setStreamingRole(role);
    setStreamText("");
    setThinkingSeconds(0);

    const controller = new AbortController();
    abortRef.current = controller;

    const thinkingTimer = setInterval(() => {
      setThinkingSeconds((s) => s + 1);
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
          skipSaveHuman,
          skipSaveAgent,
          cleanContext,
          ...(skillGroup ? { skillGroup } : {}),
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
        // Timeout: if no data for 2 minutes, abort the stream
        let lastDataAt = Date.now();
        const STREAM_TIMEOUT = 2 * 60 * 1000; // 2 minutes
        const timeoutCheck = setInterval(() => {
          console.log("[TIMEOUT-CHECK] interval fired, idle:", Math.round((Date.now() - lastDataAt) / 1000), "s");
          if (Date.now() - lastDataAt > STREAM_TIMEOUT) {
            clearInterval(timeoutCheck);
            console.log("[TIMEOUT-CHECK] ABORTING — no data for", STREAM_TIMEOUT / 1000, "s");
            console.warn(`[stream] no data for ${STREAM_TIMEOUT / 1000}s, aborting`);
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
      if (controller.signal.aborted) return ""; // aborted before any data
      throw err;
    } finally {
      clearInterval(thinkingTimer);
      abortRef.current = null;
    }
  }

  // Extract past revision reflections from messages to feed into writer context
  function getPastReflections(): string {
    const reflections = messages
      .filter((m) => m.content.startsWith("📋 **修稿反思**"))
      .slice(-3) // last 3 reflections
      .map((m) => m.content.replace("📋 **修稿反思**\n\n", "").trim());
    if (reflections.length === 0) return "";
    return `\n\n---\n\n## 往期修稿反思（避免重复犯错）\n\n${reflections.join("\n\n---\n\n")}`;
  }

  // Save a draft section to disk via API
  async function saveDraft(sectionId: string, content: string) {
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectSlug: slug, sectionId, content }),
      });
      if (res.ok) {
        console.log(`[draft] saved ${sectionId} (${content.length} chars)`);
      }
    } catch (err) {
      console.error("[draft] save failed:", err);
    }
  }

  // Extract the prose content from a writer message (strip markdown headers, revision notes, etc.)
  function extractProseContent(text: string): string {
    // Remove common writer output wrappers
    let prose = text;
    // Remove ```markdown ... ``` wrappers
    prose = prose.replace(/^```(?:markdown)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "");
    // Remove "# 标题" headers that are chapter titles
    prose = prose.replace(/^#\s+.+\n+/gm, "");
    // Remove adoption checklists "### 采纳清单" and everything after
    const adoptIdx = prose.indexOf("### 采纳清单");
    if (adoptIdx > 0) prose = prose.slice(0, adoptIdx);
    const adoptIdx2 = prose.indexOf("## 采纳清单");
    if (adoptIdx2 > 0) prose = prose.slice(0, adoptIdx2);
    return prose.trim();
  }

  // Prompt user to save a draft section after writer output is approved
  async function promptSaveDraft(writerContent: string) {
    const prose = extractProseContent(writerContent);
    if (prose.length < 50) return; // too short, probably not actual prose

    // Auto-detect section name from the conversation context
    // Look at the last human message for hints like "阳三", "阴一.2", etc.
    const recentHuman = messages.filter((m) => m.role === "human").slice(-3);
    const chapterPattern = /[阳阴][一二三四五六七八][.\.]?\d*/;
    let detectedSection = "";
    for (const m of recentHuman.reverse()) {
      const match = m.content.match(chapterPattern);
      if (match) {
        detectedSection = match[0].replace(".", ".");
        break;
      }
    }

    if (detectedSection) {
      // Auto-save with detected section name
      await saveDraft(detectedSection, prose);
      setMessages((prev) => [...prev, {
        id: `system-save-${Date.now()}`,
        role: "human",
        content: `💾 已自动保存为 **${detectedSection}** (${prose.length}字)`,
        createdAt: new Date().toISOString(),
      }]);
    }
    // If no section detected, don't auto-save — user will need to specify
  }

  // Shared revision loop: editor→writer→editor cycles with reader scoring
  async function runRevisionLoop(initialEditorReview: string) {
    const MAX_ROUNDS = 3;
    let latestEditorReview = initialEditorReview;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const humanFeedback = await waitForRevisionFeedback();
      if (humanFeedback) {
        setMessages((prev) => [...prev, {
          id: `human-feedback-${Date.now()}`,
          role: "human",
          content: humanFeedback,
          createdAt: new Date().toISOString(),
        }]);
      }

      // Writer revises with clean context
      const feedbackSection = humanFeedback
        ? `\n\n---\n\n## 创作者意见（优先级最高）\n\n${humanFeedback}`
        : "";
      const writerPrompt = `请根据以下审稿意见修改稿件。

⚠️ 改稿铁律：
1. 【守住清单】里的内容一字不动
2. 只改铁面明确指出的问题，不要动其他地方
3. 修改方向是写得更好，不是写得更短更安全
4. 禁止把长句拆成碎片短句，禁止删掉具体意象换成概括
5. 改完的稿件不应比原稿短超过10%

输出修改后的完整文本，并附采纳清单。

---

## 审稿意见

${latestEditorReview}${feedbackSection}${getPastReflections()}`;
      // Writer revises with "revision" skill group (compression, surgical-revision, voice-consistency)
      const writerText = await streamOneAgent("writer", writerPrompt, true, true, true, "revision");
      const writerDisplay = writerText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      setStreamText("");
      setMessages((prev) => [...prev, {
        id: `agent-${Date.now()}-writer-r${round}`,
        role: "writer", model: activeProvider, content: writerDisplay,
        createdAt: new Date().toISOString(), intermediate: true,
      }]);

      // Editor re-reviews with clean context (routed to Gemini via API — no CLI wait)
      const editorPrompt = `请审稿。按你的审稿流程审核以下稿件。注意：必须先列出【守住清单】，然后再列问题。如果稿件质量达标（无P0问题，P1问题可接受），在回复最后单独一行写 [APPROVED]。

---

## 稿件

${writerDisplay}`;
      const editorText = await streamOneAgent("editor", editorPrompt, true, true, true);
      const editorApproved = editorText.includes("[APPROVED]");
      const editorDisplay = editorText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      latestEditorReview = editorDisplay;
      setStreamText("");
      setMessages((prev) => [...prev, {
        id: `agent-${Date.now()}-editor-r${round}`,
        role: "editor", model: activeProvider, content: editorDisplay,
        createdAt: new Date().toISOString(), intermediate: true,
      }]);

      if (editorApproved) {
        // Auto-save the approved draft
        await promptSaveDraft(writerDisplay);
        break;
      }
    }

    // Reflection
    const reflectPrompt = `刚才完成了一轮修稿循环。请用不超过150字写一份简短的反思备忘录，格式如下：

### 反复出现的问题
- [1-3条]

### 有效的改进
- [1-3条]

### 下次写作注意
- [给妙笔的具体提醒，1-3条]

只输出备忘录本身，不要多余的话。`;
    const reflectText = await streamOneAgent("editor", reflectPrompt, true, true, true);
    const reflectDisplay = reflectText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
    setStreamText("");
    setMessages((prev) => [...prev, {
      id: `agent-${Date.now()}-reflection`,
      role: "editor", model: activeProvider,
      content: `📋 **修稿反思**\n\n${reflectDisplay}`,
      createdAt: new Date().toISOString(),
    }]);
  }

  // Pause revision loop and wait for user to either submit feedback or click continue.
  // Returns the feedback string (empty string = no feedback, just continue).
  function waitForRevisionFeedback(): Promise<string> {
    return new Promise<string>((resolve) => {
      revisionResolveRef.current = resolve;
      setRevisionPaused(true);
      setRevisionFeedbackInput("");
    });
  }

  function submitRevisionFeedback(feedback: string) {
    setRevisionPaused(false);
    if (revisionResolveRef.current) {
      revisionResolveRef.current(feedback);
      revisionResolveRef.current = null;
    }
  }

  // Phase-aware follow-up prompts for non-first agents in the roundtable
  // previousRoles: which agents have already spoken in this round
  function getFollowUpPrompt(phase: string, role: string, previousRoles: string[]): string {
    const category = ROLE_META[role]?.category ?? role;

    if (phase === "scriptment" && role === "editor") {
      return "（请按 Phase 4 的结构审稿三维度发言：信息经济、场景功能、跨场景重复。不要改写文本，只给决策级意见。）";
    }

    if (phase === "expansion" || phase === "draft" || phase === "review") {
      if (role === "character") {
        return "（Pre/Post 章节圆桌：请给出角色声音DNA、关系状态、不要重复的细节，或验证当前章的声音一致性。每次不超过3点。）";
      }
      if (role === "architect") {
        return "（Pre/Post 章节圆桌：请给出本章结构功能、上下章衔接、scriptment对应段落，或检查是否偏离骨架。每次不超过3点。）";
      }
      // editor reviews what writer wrote
      if (role === "editor") {
        return "（Post-Review 圆桌：请检查骨架对齐、语言问题、字数和是否需要返修。先列【守住清单】，再列P0/P1/P2。如果可进入下一章，在最后单独一行写 [APPROVED]。）";
      }
      // writer revises based on editor's review
      if (role === "writer" && previousRoles.includes("editor")) {
        return "（铁面刚完成了审稿。请根据审稿意见修改稿件。\n\n⚠️ 改稿铁律：\n1. 【守住清单】里的内容一字不动\n2. 只改铁面明确指出的问题，不要动其他地方\n3. 修改方向是写得更好，不是写得更短更安全\n4. 禁止把长句拆成碎片短句，禁止删掉具体意象换成概括\n5. 改完的稿件不应比原稿短超过10%\n\n输出修改后的完整文本，并附采纳清单。）";
      }
    }

    // Default: generic discussion prompt
    return `（以上是创作者的消息和其他agent的讨论。请以${category}的专业视角，补充你的意见、提出不同角度、或回应之前agent的观点。简洁有力，不要重复别人说过的。）`;
  }

  // Build a discussion-round prompt for an agent, referencing what others said
  function getDiscussionPrompt(role: string, roundNum: number, otherSpeakers: string[]): string {
    const myName = ROLE_META[role]?.label ?? role;
    const othersStr = otherSpeakers.map((r) => ROLE_META[r]?.label ?? r).join("、");
    const category = ROLE_META[role]?.category ?? role;

    if (roundNum === 1) {
      return `（讨论继续。${othersStr}刚才都发表了意见。作为${myName}（${category}），自然地回应——赞同、反驳、补充、追问都行，随你。点名说，别泛泛而谈。没什么要说的就输出 [PASS]。）`;
    }

    return `（第${roundNum}轮讨论。接着聊，有新想法就说，没有就输出 [PASS]。）`;
  }

  // Fire-and-forget: detect user feedback and absorb into agent notes
  function absorbFeedback(userMessage: string) {
    const recentMsgs = messages.slice(-8).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 600),
    }));
    fetch("/api/agent-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: slug,
        userMessage,
        recentMessages: recentMsgs,
        provider: activeProvider,
      }),
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (data.absorbed && data.items?.length) {
          console.log("[feedback absorbed]", data.items);
        }
      }
    }).catch(() => { /* silent */ });
  }

  // Roundtable: send to all agents at the table
  async function addAttachments(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const loaded = await Promise.all(
      files.map(async (f) => ({ name: f.name, content: await f.text() }))
    );
    setAttachedFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...loaded.filter((f) => !names.has(f.name))];
    });
  }

  async function send(text?: string) {
    const rawMsg = text ?? input.trim();
    const files = attachedFiles;
    if (!rawMsg && files.length === 0) return;
    if (streaming && !stoppedRef.current) return; // allow if we just stopped

    // Build message with attached file contents
    let msg = rawMsg;
    if (files.length > 0) {
      const fileParts = files.map((f) => `=== ${f.name} ===\n${f.content}`).join("\n\n");
      msg = msg
        ? `${msg}\n\n---\n\n附件材料：\n\n${fileParts}`
        : `请阅读以下材料：\n\n${fileParts}`;
    }

    setInput("");
    setAttachedFiles([]);
    setWriterPause(false);
    setWriterFeedback("");
    setStreaming(true);
    stoppedRef.current = false;
    setError("");
    setSaveStatus("saving");

    const humanMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "human",
      content: msg,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, humanMsg]);

    // Fire-and-forget: absorb user feedback into agent notes
    if (rawMsg.length > 5) {
      absorbFeedback(rawMsg);
    }

    // Helper: check if user stopped the discussion
    const wasStopped = () => stoppedRef.current;

    // Get the panel of agents for current phase, reordered by @ mentions
    const basePanel = PHASE_PANEL[currentPhase] ?? ["idea"];
    // Parse @mentions: match @label (e.g. @铁面, @妙笔) → resolve to role key
    const mentionedRoles: string[] = [];
    const labelToRole: Record<string, string> = {};
    for (const [role, meta] of Object.entries(ROLE_META)) {
      if (role !== "human") labelToRole[meta.label] = role;
    }
    const mentionRegex = /@([\u4e00-\u9fff\w]+)/g;
    let match;
    while ((match = mentionRegex.exec(msg)) !== null) {
      const role = labelToRole[match[1]];
      if (role && !mentionedRoles.includes(role)) mentionedRoles.push(role);
    }
    // Reorder panel: mentioned agents first (in mention order), then rest of panel
    let panel: string[];
    if (mentionedRoles.length > 0) {
      // Include mentioned agents even if not in default panel
      const rest = basePanel.filter((r) => !mentionedRoles.includes(r));
      panel = [...mentionedRoles, ...rest];
    } else {
      panel = basePanel;
    }
    let sawPhaseComplete = false;
    const previousRoles: string[] = [];
    const isDraftLoop = currentPhase === "expansion" || currentPhase === "draft" || currentPhase === "review";

    try {
      // --- Standard panel pass (all phases) ---
      for (let i = 0; i < panel.length; i++) {
        const agentRole = panel[i];
        const isFirst = i === 0;

        const agentMsg = isFirst
          ? msg
          : getFollowUpPrompt(currentPhase, agentRole, previousRoles);

        const fullText = await streamOneAgent(agentRole, agentMsg, !isFirst);
        previousRoles.push(agentRole);

        const phaseComplete = fullText.includes("[PHASE_COMPLETE]");
        const approved = fullText.includes("[APPROVED]");
        const displayText = fullText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();

        if (displayText.length > 0) {
          setStreamText("");
          setMessages((prev) => [
            ...prev,
            {
              id: `agent-${Date.now()}-${agentRole}`,
              role: agentRole,
              model: activeProvider,
              content: displayText,
              createdAt: new Date().toISOString(),
            },
          ]);
        }

        if (wasStopped()) break;
        if (phaseComplete) sawPhaseComplete = true;

        // --- Draft/review: editor reviewed ---
        if (isDraftLoop && agentRole === "editor") {
          if (approved) {
            // Editor approved directly — save the writer's output
            const lastWriterMsg = [...messages].reverse().find((m) => m.role === "writer");
            if (lastWriterMsg) await promptSaveDraft(lastWriterMsg.content);
          } else {
            // Not approved → enter revision loop
            await runRevisionLoop(displayText);
          }
        }
      }

      // --- Discussion rounds (non-draft phases only) ---
      // After each agent speaks once, let them discuss/debate for 1-2 rounds
      const isDiscussionPhase = !isDraftLoop && panel.length >= 2 && !sawPhaseComplete;
      if (isDiscussionPhase && !wasStopped()) {
        const MAX_DISCUSSION_ROUNDS = 2;
        const activeSpeakers = new Set(panel);

        for (let dRound = 1; dRound <= MAX_DISCUSSION_ROUNDS; dRound++) {
          if (activeSpeakers.size < 2 || wasStopped()) break;

          let anyoneSpoke = false;

          for (const agentRole of panel) {
            if (!activeSpeakers.has(agentRole) || wasStopped()) continue;

            const others = panel.filter((r) => r !== agentRole);
            const prompt = getDiscussionPrompt(agentRole, dRound, others);
            const fullText = await streamOneAgent(agentRole, prompt, true);

            if (wasStopped()) {
              // Save partial text if any
              const partial = fullText.replace(/\n?\[(PHASE_COMPLETE|APPROVED|PASS)\]\n?/g, "").trim();
              if (partial.length > 0) {
                setStreamText("");
                setMessages((prev) => [...prev, {
                  id: `agent-${Date.now()}-${agentRole}-d${dRound}`,
                  role: agentRole, model: activeProvider,
                  content: partial, createdAt: new Date().toISOString(),
                }]);
              }
              break;
            }

            const displayText = fullText.replace(/\n?\[(PHASE_COMPLETE|APPROVED|PASS)\]\n?/g, "").trim();
            const passed = fullText.includes("[PASS]") || displayText.length < 30;

            if (passed) {
              activeSpeakers.delete(agentRole);
            } else {
              anyoneSpoke = true;
              setStreamText("");
              setMessages((prev) => [
                ...prev,
                {
                  id: `agent-${Date.now()}-${agentRole}-d${dRound}`,
                  role: agentRole,
                  model: activeProvider,
                  content: displayText,
                  createdAt: new Date().toISOString(),
                },
              ]);

              if (fullText.includes("[PHASE_COMPLETE]")) {
                sawPhaseComplete = true;
              }
            }
          }

          if (!anyoneSpoke || wasStopped()) break;
        }
      }

      // --- Chronicler: dramatize the discussion ---
      // Runs after panel + discussion, reads full history, writes a short narrative
      const totalAgentMsgs = panel.length + (isDiscussionPhase ? panel.length * 2 : 0); // rough estimate
      if (totalAgentMsgs >= 3 && !wasStopped()) {
        const chroniclerPrompt = `请阅读上面这一轮完整的圆桌讨论（从创作者最新的消息开始，到刚才讨论结束），写一篇300-800字的幕后纪实短文。

要求：只挑最关键、最有戏的部分。写法参见你的角色定义。直接输出正文。`;
        const chronicleText = await streamOneAgent("chronicler", chroniclerPrompt, true);
        const chronicleDisplay = chronicleText.replace(/\n?\[(PHASE_COMPLETE|APPROVED|PASS)\]\n?/g, "").trim();

        if (chronicleDisplay.length > 50) {
          setStreamText("");
          setMessages((prev) => [
            ...prev,
            {
              id: `agent-${Date.now()}-chronicler`,
              role: "chronicler",
              model: activeProvider,
              content: chronicleDisplay,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
      if (sawPhaseComplete) setShowPhasePrompt(true);
    } catch (err) {
      console.error("Chat error:", err);
      setError(err instanceof Error ? err.message : "发送失败，请重试");
      setSaveStatus("idle");
    } finally {
      setStreaming(false);
    }
  }

  // Continue writing: writer produces next 300-500 word chunk (or revises current one)
  async function continueWriting(feedback?: string) {
    if (streaming) return;
    setWriterPause(false);
    setWriterFeedback("");
    setStreaming(true);
    setError("");
    setSaveStatus("saving");

    const prompt = feedback?.trim()
      ? `请根据以下意见修改刚才那段，输出修改后的完整段落：${feedback.trim()}`
      : "继续写下一个beat（300-500字）。衔接好上文节奏，写下一个情节单元，暂停在合适的断点。";

    try {
      const fullText = await streamOneAgent("writer", prompt, true);
      const displayText = fullText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      setStreamText("");
      setMessages((prev) => [...prev, {
        id: `agent-${Date.now()}-writer`,
        role: "writer",
        model: activeProvider,
        content: displayText,
        createdAt: new Date().toISOString(),
      }]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
      setWriterPause(true); // pause again after each chunk
    } catch (err) {
      setError(err instanceof Error ? err.message : "写作失败，请重试");
      setSaveStatus("idle");
    } finally {
      setStreaming(false);
    }
  }

  // Trigger review: hand off to editor, then auto-run writer→editor revision loop
  // Trigger review: editor reviews, then revision loop if not approved
  async function triggerReview() {
    if (streaming) return;
    setWriterPause(false);
    setStreaming(true);
    setError("");
    setSaveStatus("saving");

    try {
      const editorPrompt = getFollowUpPrompt("review", "editor", ["writer"]);
      const editorText = await streamOneAgent("editor", editorPrompt, true);
      const approved = editorText.includes("[APPROVED]");
      const editorDisplay = editorText.replace(/\n?\[(PHASE_COMPLETE|APPROVED)\]\n?/g, "").trim();
      setStreamText("");
      setMessages((prev) => [...prev, {
        id: `agent-${Date.now()}-editor`,
        role: "editor", model: activeProvider, content: editorDisplay,
        createdAt: new Date().toISOString(),
      }]);

      if (!approved) {
        await runRevisionLoop(editorDisplay);
      }

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "审稿失败，请重试");
      setSaveStatus("idle");
    } finally {
      setStreaming(false);
    }
  }

  // Independent review — collect recent agent outputs and ask reviewer to critique
  async function requestReview() {
    if (streaming) return;
    // Gather the most recent substantive agent messages (skip human, context, chronicler, reviewer)
    const skipRoles = new Set(["human", "context", "chronicler", "reviewer"]);
    const agentOutputs = messages
      .filter((m) => !skipRoles.has(m.role) && !m.intermediate && m.content.length > 50)
      .slice(-10); // last 10 substantive messages

    if (agentOutputs.length === 0) {
      setError("没有可供评审的内容");
      return;
    }

    const docText = agentOutputs
      .map((m) => {
        const meta = ROLE_META[m.role];
        return `[${meta?.label ?? m.role}]:\n${m.content}`;
      })
      .join("\n\n---\n\n");

    const reviewPrompt = `请以独立评审的身份，审阅以下圆桌讨论产出的文档内容。你与创作团队无关，不了解讨论过程，只看产出质量。

---

${docText}

---

请按照你的评审规则，给出独立评审意见。注意：只评价内容本身的质量，不要评价讨论过程。`;

    setStreaming(true);
    setStreamingRole("reviewer");
    try {
      const fullText = await streamOneAgent("reviewer", reviewPrompt, true);
      // Save reviewer message
      const reviewMsg: Message = {
        id: `review-${Date.now()}`,
        role: "reviewer",
        content: fullText,
        model: activeProvider,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, reviewMsg]);
      // Persist
      await fetch(`/api/chat?projectSlug=${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewMsg),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "评审失败");
    } finally {
      setStreaming(false);
      setStreamingRole("");
      setStreamText("");
    }
  }

  function stopDiscussion() {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  // --- @ mention helpers ---
  const MENTION_CANDIDATES = Object.entries(ROLE_META)
    .filter(([k]) => k !== "human" && k !== "context")
    .map(([role, meta]) => ({ role, label: meta.label, icon: meta.icon }));

  function getMentionCandidates(filter: string) {
    if (!filter) return MENTION_CANDIDATES;
    return MENTION_CANDIDATES.filter((c) => c.label.includes(filter) || c.role.includes(filter.toLowerCase()));
  }

  function insertMention(candidate: { role: string; label: string }) {
    const start = mentionStartRef.current;
    if (start < 0) return;
    const before = input.slice(0, start); // everything before '@'
    const afterAt = input.slice(start + 1); // everything after '@'
    // Find end of current filter text (until space or end)
    const spaceIdx = afterAt.search(/[\s，。！？]/);
    const after = spaceIdx >= 0 ? afterAt.slice(spaceIdx) : "";
    const newInput = `${before}@${candidate.label}${after ? after : " "}`;
    setInput(newInput);
    setMentionOpen(false);
    setMentionFilter("");
    mentionStartRef.current = -1;
    // Focus back and set cursor after the inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const cursorPos = before.length + 1 + candidate.label.length + 1;
        inputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);

    const cursor = e.target.selectionStart ?? val.length;
    // Look backwards from cursor for an '@' that starts a mention
    const textBeforeCursor = val.slice(0, cursor);
    const atIdx = textBeforeCursor.lastIndexOf("@");
    if (atIdx >= 0) {
      // Only trigger if @ is at start or preceded by whitespace
      const charBefore = atIdx > 0 ? textBeforeCursor[atIdx - 1] : " ";
      const filterText = textBeforeCursor.slice(atIdx + 1);
      // No spaces in the filter (not a mention if there's a space after @)
      if ((charBefore === " " || charBefore === "\n" || atIdx === 0) && !/\s/.test(filterText)) {
        const candidates = getMentionCandidates(filterText);
        if (candidates.length > 0) {
          setMentionOpen(true);
          setMentionFilter(filterText);
          setMentionIdx(0);
          mentionStartRef.current = atIdx;
          return;
        }
      }
    }
    setMentionOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // @ mention dropdown navigation
    if (mentionOpen) {
      const candidates = getMentionCandidates(mentionFilter);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (candidates[mentionIdx]) insertMention(candidates[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (streaming && input.trim()) {
        stopDiscussion();
        const userText = input.trim();
        setInput("");
        setTimeout(() => send(userText), 100);
      } else if (streaming) {
        stopDiscussion();
      } else {
        send();
      }
    }
  }

  const roleMeta = ROLE_META.idea; // fallback only

  // Count messages by role
  const msgStats = messages.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const PHASE_LABELS_SHORT: Record<string, string> = {
    conception: "构思",
    bible: "角色",
    structure: "结构",
    scriptment: "速写",
    expansion: "扩写",
    draft: "扩写",
    review: "扩写",
    final: "扩写",
  };

  return (
    <main className="h-screen bg-background text-foreground flex overflow-hidden">
      {/* Left sidebar — navigation + flow */}
      <aside className="w-[280px] shrink-0 border-r border-border/40 bg-background-warm flex flex-col hidden lg:flex">
        {/* Logo / Home */}
        <div className="px-4 py-4">
          <Link href="/" className="flex items-center gap-2 text-muted/50 hover:text-foreground transition-colors">
            <span className="font-brush text-xl text-gradient">神仙会</span>
          </Link>
        </div>

        <div className="h-px bg-border/30" />

        {/* Project list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          <h3 className="text-[10px] text-foreground/25 font-medium tracking-wider uppercase px-2 mb-2">项目</h3>
          {allProjects.map((p) => (
            <a
              key={p.slug}
              href={`/project/${p.slug}`}
              className={`block px-3 py-2 rounded-lg text-sm transition-all truncate ${
                p.slug === slug
                  ? "bg-accent/10 text-accent font-medium border border-accent/20"
                  : "text-foreground/50 hover:text-foreground/80 hover:bg-surface-hover/40"
              }`}
            >
              <div className="truncate">{p.title}</div>
              {p.phase && (
                <span className="text-[10px] text-foreground/25">{PHASE_LABELS_SHORT[p.phase] ?? p.phase}</span>
              )}
            </a>
          ))}
        </div>

        <div className="h-px bg-border/30" />

        {/* Flow progress */}
        <div className="px-3 py-4 space-y-1">
          <h3 className="text-[10px] text-foreground/25 font-medium tracking-wider uppercase px-2 mb-2">创作流程</h3>
          {FLOW_STEPS.map((step) => {
            const isActive = step.key === currentPhase;
            const isPast = FLOW_STEPS.findIndex((s) => s.key === currentPhase) >
              FLOW_STEPS.findIndex((s) => s.key === step.key);
            const stepMeta = ROLE_META[step.agent];

            return (
              <button
                key={step.key}
                onClick={() => setPhase(step.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-all flex items-center gap-2 ${
                  isActive
                    ? "bg-accent/10 text-accent font-medium"
                    : isPast
                    ? "text-foreground/35 hover:bg-surface-hover/40"
                    : "text-foreground/20 hover:bg-surface-hover/30"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isActive
                      ? "bg-accent shadow-[0_0_6px_rgba(94,138,133,0.5)]"
                      : isPast
                      ? "bg-foreground/20"
                      : "bg-foreground/10"
                  }`}
                />
                <span>{stepMeta?.icon} {step.label}</span>
                {isPast && <span className="text-[9px] text-foreground/15 ml-auto">✓</span>}
              </button>
            );
          })}
          {FLOW_STEPS.findIndex((s) => s.key === currentPhase) < FLOW_STEPS.length - 1 && (
            <button
              onClick={startPhaseTransition}
              disabled={summaryLoading}
              className="mt-2 w-full px-3 py-2 text-[12px] text-accent/70 hover:text-accent bg-accent/5 hover:bg-accent/10 border border-accent/15 rounded-lg transition-all disabled:opacity-50"
            >
              {summaryLoading ? "总结中..." : "下一阶段 →"}
            </button>
          )}
          <button
            onClick={requestReview}
            disabled={streaming || messages.length === 0}
            className="mt-2 w-full px-3 py-2 text-[12px] text-rose-300/70 hover:text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-400/15 rounded-lg transition-all disabled:opacity-30 disabled:cursor-default"
          >
            🔍 独立评审
          </button>
        </div>
      </aside>

      {/* Center — chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Slim top bar */}
        <header className="shrink-0 px-6 py-2.5 flex items-center justify-between relative">
          <div className="flex items-center gap-3">
            <span className="font-bold text-gradient-subtle">
              {projectTitle || decodeURIComponent(slug)}
            </span>
            <span className="text-[11px] text-muted/30">
              {saveStatus === "saving" && "保存中..."}
              {saveStatus === "saved" && "✓ 已保存"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Chat management menu */}
            <div className="relative">
              <button
                onClick={() => { setShowChatMenu(!showChatMenu); setConfirmClear(false); }}
                className="px-2 py-1 text-muted/40 hover:text-foreground text-sm transition-colors rounded-lg hover:bg-surface-hover/50"
                title="对话管理"
              >
                ···
              </button>
              {showChatMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setShowChatMenu(false); setConfirmClear(false); }} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 glass rounded-xl border border-border-light/50 py-1.5 shadow-xl">
                    {!confirmClear ? (
                      <>
                        <button
                          onClick={() => { fileInputRef.current?.click(); }}
                          className="w-full text-left px-4 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-hover/50 transition-colors"
                        >
                          导入 Markdown
                        </button>
                        <button
                          onClick={exportMarkdown}
                          disabled={messages.length === 0}
                          className="w-full text-left px-4 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-hover/50 disabled:text-muted/20 disabled:hover:bg-transparent transition-colors"
                        >
                          导出为 Markdown
                        </button>
                        <div className="h-px bg-border/40 my-1" />
                        <button
                          onClick={() => setConfirmClear(true)}
                          disabled={messages.length === 0}
                          className="w-full text-left px-4 py-2 text-sm text-muted hover:text-red-400 hover:bg-surface-hover/50 disabled:text-muted/20 disabled:hover:bg-transparent transition-colors"
                        >
                          清空全部对话
                        </button>
                        <div className="h-px bg-border/40 my-1" />
                        <div className="px-4 py-1.5 text-[11px] text-muted/30">
                          {messages.length} 条消息
                        </div>
                      </>
                    ) : (
                      <div className="px-4 py-2">
                        <p className="text-sm text-red-400/80 mb-2">确认清空所有对话？此操作不可撤销。</p>
                        <div className="flex gap-2">
                          <button
                            onClick={clearAllMessages}
                            className="px-3 py-1 text-xs text-red-400 bg-red-900/20 rounded-lg border border-red-500/20"
                          >
                            确认清空
                          </button>
                          <button
                            onClick={() => setConfirmClear(false)}
                            className="px-3 py-1 text-xs text-muted bg-surface-hover/60 rounded-lg"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Roundtable icons */}
            <div className="flex gap-1">
              {(PHASE_PANEL[currentPhase] ?? ["idea"]).map((role) => {
                const meta = ROLE_META[role];
                return (
                  <span
                    key={role}
                    className="text-[12px] px-1.5 py-0.5 glass rounded-md"
                    title={meta?.label}
                  >
                    {meta?.icon}
                  </span>
                );
              })}
            </div>

            {/* Model selector */}
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value)}
              className="bg-surface/80 border border-border/60 rounded-lg px-2 py-1 text-[13px] outline-none hover:border-border-light focus:border-accent/40 transition-colors"
            >
              <option value="claude-code">Claude Max</option>
              <option value="gpt">GPT</option>
              <option value="deepseek">DeepSeek</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude API</option>
            </select>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-light/40 to-transparent" />
        </header>

        {currentPhase === "expansion" ? (
          <DraftWorkspace slug={slug} activeProvider={activeProvider} />
        ) : (
          <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-6 space-y-6">
              {/* Welcome state */}
              {messages.length === 0 && !streaming && (
                <div className="py-20 relative">
                  {/* Background glow */}
                  <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-accent/5 blur-[100px]" />

                  <div className="text-center mb-12 relative">
                    <div className="text-5xl mb-5 opacity-50">✦</div>
                    <h2 className="text-3xl font-bold text-gradient mb-4">
                      开始构思你的故事
                    </h2>
                    <p className="text-muted/60 leading-relaxed max-w-lg mx-auto text-[15px]">
                      灵犀会引导你一步步打磨想法
                      <br />
                      从模糊的灵感到清晰的故事核心
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3 relative">
                    {WELCOME_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => {
                          setInput(prompt);
                          inputRef.current?.focus();
                        }}
                        className="px-5 py-2.5 glass rounded-full text-sm text-muted/60 hover:text-foreground/80 hover:border-border-light transition-all hover:glow-accent"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message list — grouped into rounds */}
              {rounds.map((round, roundIdx) => {
                const isCollapsed = collapsedRounds.has(round.id);
                const isLastRound = roundIdx === rounds.length - 1;
                const phaseLabel = FLOW_STEPS.find((s) => s.key === round.phase)?.label;
                const agentIcons = [...new Set(round.agentMsgs.map((m) => ROLE_META[m.role]?.icon).filter(Boolean))];
                const timeStr = new Date(round.timestamp).toLocaleString("zh-CN", {
                  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
                });

                return (
                  <div key={round.id} className="relative">
                    {/* Round header — collapse toggle, tags, timestamp */}
                    {(round.humanMsg || round.agentMsgs.length > 1) && (
                      <div
                        className="flex items-center gap-2 mb-2 cursor-pointer group/round select-none"
                        onClick={() => !isLastRound && toggleRound(round.id, round)}
                      >
                        {!isLastRound && (
                          <span className="text-[11px] text-muted/25 group-hover/round:text-foreground/40 transition-colors w-4">
                            {isCollapsed ? "▶" : "▼"}
                          </span>
                        )}
                        {phaseLabel && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent/60">
                            {phaseLabel}
                          </span>
                        )}
                        {agentIcons.length > 0 && (
                          <span className="text-[11px] text-muted/30">
                            {agentIcons.join(" ")}
                          </span>
                        )}
                        <span className="text-[11px] text-muted/20">{timeStr}</span>
                        {isCollapsed && roundSummaries[round.id] && (
                          <span className="text-[11px] text-foreground/30 truncate flex-1 italic">
                            {roundSummaries[round.id]}
                          </span>
                        )}
                        {isCollapsed && !roundSummaries[round.id] && round.humanMsg && (
                          <span className="text-[11px] text-foreground/25 truncate flex-1">
                            {round.humanMsg.content.slice(0, 60).replace(/\n/g, " ")}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Round content — collapsible */}
                    {!isCollapsed && (
                      <div className="space-y-5">
                        {/* Human message */}
                        {round.humanMsg && (
                          <div data-human-msg className="group/msg flex justify-end">
                            <div className="relative max-w-2xl bg-accent/8 border border-accent/10 rounded-2xl rounded-br-sm px-5 py-3">
                              <button
                                onClick={() => deleteMessage(round.humanMsg!.id)}
                                className="absolute -left-6 top-3 text-[11px] text-muted/15 hover:text-red-400 opacity-0 group-hover/msg:opacity-100 transition-all"
                                title="删除此消息"
                              >
                                ✕
                              </button>
                              <div className="whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground/85">
                                {round.humanMsg.content}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Agent messages */}
                        {round.agentMsgs.map((m) => {
                          const meta = ROLE_META[m.role] ?? {
                            label: m.role, category: m.role, color: "text-muted", icon: "?",
                          };

                          // Intermediate draft/review rounds — collapsed by default
                          if (m.intermediate) {
                            const roundLabel = m.role === "writer" ? "改稿" : "审稿";
                            const preview = m.content.slice(0, 80).replace(/\n/g, " ");
                            return (
                              <div key={m.id} className="group/msg">
                                <details className="glass rounded-xl border border-foreground/5 overflow-hidden opacity-50">
                                  <summary className="px-4 py-2 cursor-pointer flex items-center gap-2 text-sm hover:bg-surface-hover/30 transition-colors">
                                    <span className="text-xs">{meta.icon}</span>
                                    <span className={`text-xs ${meta.color}`}>{meta.label}·{roundLabel}</span>
                                    <span className="text-muted/25 text-xs truncate flex-1">{preview}…</span>
                                    <span className="text-[11px] text-muted/20">中间稿</span>
                                  </summary>
                                  <div className="px-4 py-3 border-t border-border/30 max-h-80 overflow-y-auto">
                                    <div className="whitespace-pre-wrap text-[13px] leading-[1.7] text-foreground/50">
                                      {m.content}
                                    </div>
                                  </div>
                                </details>
                              </div>
                            );
                          }

                          // Chronicler — literary behind-the-scenes card
                          if (m.role === "chronicler") {
                            const preview = m.content.slice(0, 100).replace(/\n/g, " ");
                            return (
                              <div key={m.id} className="group/msg">
                                <details className="glass rounded-xl border border-amber-400/15 overflow-hidden bg-amber-950/5">
                                  <summary className="px-4 py-2.5 cursor-pointer flex items-center gap-2 text-sm hover:bg-amber-900/10 transition-colors">
                                    <span>📜</span>
                                    <span className="text-amber-200/70 font-medium">史官纪实</span>
                                    <span className="text-muted/30 text-xs truncate flex-1 italic">{preview}…</span>
                                    <button
                                      onClick={(e) => { e.preventDefault(); saveClip(m.content, "chronicler"); setClippedId(m.id); setTimeout(() => setClippedId(null), 1500); }}
                                      className="text-[11px] text-muted/25 hover:text-accent transition-colors"
                                      title="保存到剪贴板"
                                    >
                                      {clippedId === m.id ? "✓" : "📋"}
                                    </button>
                                  </summary>
                                  <div className="px-5 py-4 border-t border-amber-400/10 max-h-[600px] overflow-y-auto">
                                    <div className="whitespace-pre-wrap text-sm leading-[1.9] text-foreground/75 italic font-serif">
                                      {m.content}
                                    </div>
                                  </div>
                                </details>
                              </div>
                            );
                          }

                          // Reviewer — independent review card
                          if (m.role === "reviewer") {
                            return (
                              <div key={m.id} className="group/msg">
                                <div className="glass rounded-xl border border-rose-400/15 overflow-hidden bg-rose-950/5">
                                  <div className="px-4 py-2.5 flex items-center gap-2 text-sm border-b border-rose-400/10">
                                    <span>🔍</span>
                                    <span className="text-rose-300/80 font-medium">独立评审</span>
                                    <div className="ml-auto flex gap-2">
                                      <button
                                        onClick={() => { saveClip(m.content, "reviewer"); setClippedId(m.id); setTimeout(() => setClippedId(null), 1500); }}
                                        className="text-[11px] text-muted/25 hover:text-accent transition-colors"
                                        title="保存到剪贴板"
                                      >
                                        {clippedId === m.id ? "✓" : "📋"}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="px-5 py-4 max-h-[600px] overflow-y-auto">
                                    <div className="whitespace-pre-wrap text-[14px] leading-[1.8] text-foreground/70">
                                      {m.content}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // Context messages — collapsible card
                          if (m.role === "context") {
                            const label = m.model && m.model !== "import" ? m.model : "参考资料";
                            const preview = m.content.slice(0, 120).replace(/\n/g, " ");
                            return (
                              <div key={m.id} className="group/msg">
                                <details className="glass rounded-xl border border-amber-500/10 overflow-hidden">
                                  <summary className="px-4 py-2.5 cursor-pointer flex items-center gap-2 text-sm hover:bg-surface-hover/30 transition-colors">
                                    <span>📄</span>
                                    <span className="text-amber-300/60 font-medium">{label}</span>
                                    <span className="text-muted/30 text-xs truncate flex-1">{preview}…</span>
                                    <span className="text-[11px] text-muted/20">{(m.content.length / 1000).toFixed(1)}k字</span>
                                    <button
                                      onClick={(e) => { e.preventDefault(); deleteMessage(m.id); }}
                                      className="text-[11px] text-muted/15 hover:text-red-400 opacity-0 group-hover/msg:opacity-100 transition-all ml-1"
                                      title="删除此资料"
                                    >
                                      ✕
                                    </button>
                                  </summary>
                                  <div className="px-4 py-3 border-t border-border/30 max-h-80 overflow-y-auto">
                                    <div className="whitespace-pre-wrap text-[13px] leading-[1.7] text-foreground/60">
                                      {m.content}
                                    </div>
                                  </div>
                                </details>
                              </div>
                            );
                          }

                          return (
                            <div key={m.id} className="group/msg">
                              <div className="max-w-3xl">
                                <div className="flex items-center gap-1.5 mb-2">
                                  <span className="text-sm">{meta.icon}</span>
                                  <span className={`text-xs font-medium ${meta.color}`}>
                                    {meta.label}
                                  </span>
                                  {m.model && (
                                    <span className="text-[11px] text-muted/25 ml-1">
                                      {PROVIDER_LABELS[m.model] ?? m.model}
                                    </span>
                                  )}
                                  <div className="ml-auto flex gap-2 items-center">
                                    <button
                                      onClick={() => {
                                        saveClip(m.content, m.role);
                                        setClippedId(m.id);
                                        setTimeout(() => setClippedId(null), 1500);
                                      }}
                                      className="text-[11px] text-muted/25 hover:text-accent transition-colors"
                                      title="保存到剪贴板"
                                    >
                                      {clippedId === m.id ? "已保存 ✓" : "📌"}
                                    </button>
                                    <button
                                      onClick={() => deleteMessage(m.id)}
                                      className="text-[11px] text-muted/15 hover:text-red-400 opacity-0 group-hover/msg:opacity-100 transition-all"
                                      title="删除此消息"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                                <div className={
                                  m.role === "writer"
                                    ? "whitespace-pre-wrap prose-paper"
                                    : "whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground/85"
                                }>
                                  {m.content}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Round separator */}
                    {!isLastRound && <div className="border-b border-white/[0.04] mt-5" />}
                  </div>
                );
              })}

              {/* Streaming */}
              {streaming && streamText && (() => {
                const sMeta = ROLE_META[streamingRole] ?? roleMeta;
                return (
                <div className="max-w-3xl">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-sm">{sMeta.icon}</span>
                    <span className={`text-xs font-medium ${sMeta.color}`}>
                      {sMeta.label}
                    </span>
                    <span className="text-[11px] text-muted/25 ml-1">
                      {PROVIDER_LABELS[activeProvider]}
                    </span>
                  </div>
                  <div className={
                    streamingRole === "writer"
                      ? "whitespace-pre-wrap prose-paper"
                      : "whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground/85"
                  }>
                    {streamText}
                    <span className={`animate-pulse ${streamingRole === "writer" ? "text-[#5e8a85]" : "text-accent"}`}>▍</span>
                  </div>
                </div>
                );
              })()}

              {streaming && !streamText && (() => {
                const sMeta = ROLE_META[streamingRole] ?? roleMeta;
                return (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-sm">{sMeta.icon}</span>
                    <span className={`text-xs font-medium ${sMeta.color}`}>
                      {sMeta.label}
                    </span>
                    <span className="text-[11px] text-muted/25 ml-1">
                      {PROVIDER_LABELS[activeProvider]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-muted/50">
                    <span className="flex gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/70 animate-[pulse_1s_ease-in-out_infinite]" />
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/50 animate-[pulse_1s_ease-in-out_0.3s_infinite]" />
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/30 animate-[pulse_1s_ease-in-out_0.6s_infinite]" />
                    </span>
                    <span>
                      {thinkingSeconds < 3
                        ? "正在思考..."
                        : thinkingSeconds < 10
                        ? `深度思考中... ${thinkingSeconds}s`
                        : `深度推理中... ${thinkingSeconds}s`}
                    </span>
                  </div>
                </div>
                );
              })()}

              {/* Phase advance prompt */}
              {showPhasePrompt && (() => {
                const idx = FLOW_STEPS.findIndex((s) => s.key === currentPhase);
                const nextStep = idx < FLOW_STEPS.length - 1 ? FLOW_STEPS[idx + 1] : null;
                if (!nextStep) return null;
                const nextMeta = ROLE_META[nextStep.agent];
                return (
                  <div className="bg-accent/5 border border-accent/20 rounded-xl px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-accent/80 font-medium mb-1">
                        {nextMeta?.icon} 准备进入「{nextStep.label}」阶段
                      </p>
                      <p className="text-[12px] text-muted/40">
                        由{nextMeta?.label}（{nextStep.agent}）接手 · {nextStep.description}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0 ml-4">
                      <button
                        onClick={startPhaseTransition}
                        disabled={summaryLoading}
                        className="px-4 py-2 text-sm bg-accent/20 hover:bg-accent/30 text-accent rounded-lg transition-colors disabled:opacity-50"
                      >
                        {summaryLoading ? "生成总结中..." : "进入下一阶段"}
                      </button>
                      <button
                        onClick={() => setShowPhasePrompt(false)}
                        className="px-3 py-2 text-sm text-muted/40 hover:text-muted rounded-lg transition-colors"
                      >
                        继续当前
                      </button>
                    </div>
                  </div>
                );
              })()}

              {error && (
                <div className="bg-red-900/15 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300/80">
                  {error}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input */}
          <div className="shrink-0 px-8 py-4 relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
            <div className="max-w-3xl mx-auto">

              {/* Revision loop pause — user can inject feedback between rounds */}
              {revisionPaused ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-sky-400/60 font-medium tracking-wide">📝 改稿进行中</span>
                    <span className="text-[11px] text-muted/30">— 审阅铁面的意见，可以加入你的想法</span>
                  </div>
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={revisionFeedbackInput}
                      onChange={(e) => setRevisionFeedbackInput(e.target.value)}
                      placeholder="你的意见（可选）：这段对话保留、那个意象别删、节奏再快一点…"
                      rows={2}
                      className="flex-1 bg-surface/60 border border-border/60 rounded-xl px-4 py-2.5 outline-none focus:border-accent/30 text-[14px] resize-none min-h-[48px] max-h-[120px] transition-all placeholder:text-muted/20"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          submitRevisionFeedback(revisionFeedbackInput.trim());
                        }
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => submitRevisionFeedback(revisionFeedbackInput.trim())}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        revisionFeedbackInput.trim()
                          ? "bg-accent/70 hover:bg-accent"
                          : "bg-surface/60 border border-border/40 text-muted/60 hover:border-accent/40"
                      }`}
                    >
                      {revisionFeedbackInput.trim() ? "提交意见并继续" : "继续（不加意见）"}
                    </button>
                  </div>
                </div>
              ) : writerPause ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-emerald-400/60 font-medium tracking-wide">✍ 妙笔暂停</span>
                    <span className="text-[11px] text-muted/30">— 审阅这段，选择下一步</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => continueWriting()}
                      disabled={streaming}
                      className="px-4 py-2 bg-accent/70 hover:bg-accent disabled:opacity-30 rounded-lg text-sm font-medium transition-all"
                    >
                      继续写
                    </button>
                    <button
                      onClick={() => triggerReview()}
                      disabled={streaming}
                      className="px-4 py-2 bg-sky-600/60 hover:bg-sky-600/80 disabled:opacity-30 rounded-lg text-sm font-medium transition-all"
                    >
                      → 去审稿
                    </button>
                    <button
                      onClick={() => continueWriting("请重写刚才那段，换一个思路和角度，保持字数相近。")}
                      disabled={streaming}
                      className="px-4 py-2 bg-surface/60 hover:bg-surface border border-border/40 disabled:opacity-30 rounded-lg text-sm text-muted/70 transition-all"
                    >
                      重写
                    </button>
                  </div>
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={writerFeedback}
                      onChange={(e) => setWriterFeedback(e.target.value)}
                      placeholder="留言或修改意见…"
                      disabled={streaming}
                      rows={1}
                      className="flex-1 bg-surface/60 border border-border/60 rounded-xl px-4 py-2.5 outline-none focus:border-accent/30 text-[14px] disabled:opacity-40 resize-none min-h-[40px] max-h-[120px] transition-all placeholder:text-muted/20"
                    />
                    <button
                      onClick={async () => {
                        const text = writerFeedback.trim();
                        if (!text) return;
                        const msg: Message = {
                          id: `human-note-${Date.now()}`,
                          role: "human",
                          content: text,
                          createdAt: new Date().toISOString(),
                        };
                        setMessages((prev) => [...prev, msg]);
                        setWriterFeedback("");
                        await fetch(`/api/chat?projectSlug=${slug}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(msg),
                        });
                      }}
                      disabled={streaming || !writerFeedback.trim()}
                      className="px-4 py-2.5 bg-surface/60 border border-border/60 hover:border-accent/40 disabled:opacity-30 rounded-xl text-sm text-muted/60 transition-all shrink-0"
                    >
                      备注
                    </button>
                    <button
                      onClick={async () => {
                        const text = writerFeedback.trim();
                        if (!text) return;
                        // Save comment as human message first
                        const msg: Message = {
                          id: `human-note-${Date.now()}`,
                          role: "human",
                          content: text,
                          createdAt: new Date().toISOString(),
                        };
                        setMessages((prev) => [...prev, msg]);
                        setWriterFeedback("");
                        fetch(`/api/chat?projectSlug=${slug}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(msg),
                        });
                        // Then trigger rewrite
                        continueWriting(text);
                      }}
                      disabled={streaming || !writerFeedback.trim()}
                      className="px-4 py-2.5 bg-amber-600/60 hover:bg-amber-600/80 disabled:opacity-30 rounded-xl text-sm font-medium transition-all shrink-0"
                    >
                      改写
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Attached files chips */}
                  {attachedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {attachedFiles.map((f) => (
                        <span
                          key={f.name}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface/60 border border-border/40 text-xs text-muted/60 group"
                        >
                          <span className="text-muted/40">📄</span>
                          <span className="max-w-[140px] truncate">{f.name}</span>
                          <span className="text-muted/25">
                            {f.content.length > 1000
                              ? `${(f.content.length / 1000).toFixed(1)}k`
                              : `${f.content.length}字`}
                          </span>
                          <button
                            onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.name !== f.name))}
                            className="text-muted/25 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className={`flex gap-3 items-end rounded-xl transition-colors ${draggingInput ? "ring-2 ring-accent/40 bg-accent/5" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDraggingInput(true); }}
                    onDragLeave={() => setDraggingInput(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDraggingInput(false);
                      if (e.dataTransfer.files.length > 0) await addAttachments(e.dataTransfer.files);
                    }}
                  >
                    <button
                      onClick={() => attachInputRef.current?.click()}
                      disabled={streaming}
                      className="px-2 py-3 text-muted/30 hover:text-muted/60 disabled:opacity-30 transition-colors shrink-0"
                      title="附加文件"
                    >
                      📎
                    </button>
                    <div className="flex-1 relative">
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
                        placeholder={streaming ? "输入后按发送可打断讨论并加入意见..." : (attachedFiles.length > 0 ? "说说这些材料，或直接发送..." : "说点什么...  输入@选择角色")}
                        rows={1}
                        className="w-full bg-surface/60 border border-border/60 rounded-xl px-4 py-3 outline-none focus:border-accent/30 text-[15px] resize-none min-h-[48px] max-h-[200px] transition-all placeholder:text-muted/25 focus:bg-surface/80 focus:shadow-[0_0_20px_rgba(94,138,133,0.06)]"
                      />
                      {mentionOpen && (
                        <div className="absolute bottom-full left-0 mb-2 bg-surface border border-border/60 rounded-xl shadow-xl overflow-hidden min-w-[180px] z-50">
                          {getMentionCandidates(mentionFilter).map((c, i) => (
                            <button
                              key={c.role}
                              onMouseDown={(e) => { e.preventDefault(); insertMention(c); }}
                              className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                                i === mentionIdx ? "bg-accent/20 text-accent" : "hover:bg-surface-hover/50 text-foreground/70"
                              }`}
                            >
                              <span>{c.icon}</span>
                              <span className="font-medium">{c.label}</span>
                              <span className="text-muted/40 text-xs ml-auto">{c.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {streaming ? (
                      <button
                        onClick={() => {
                          if (input.trim()) {
                            // Stop and immediately send user's input
                            stopDiscussion();
                            const userText = input.trim();
                            setInput("");
                            // Wait a tick for streaming to stop, then send
                            setTimeout(() => send(userText), 100);
                          } else {
                            stopDiscussion();
                          }
                        }}
                        className="px-6 py-3 bg-rose-600/80 hover:bg-rose-600 rounded-xl text-sm font-medium transition-all hover:shadow-[0_0_16px_rgba(225,29,72,0.25)] shrink-0"
                      >
                        {input.trim() ? "打断发言" : "停止"}
                      </button>
                    ) : (
                      <button
                        onClick={() => send()}
                        disabled={!input.trim() && attachedFiles.length === 0}
                        className="px-6 py-3 bg-accent/80 hover:bg-accent disabled:bg-surface/40 disabled:text-muted/30 rounded-xl text-sm font-medium transition-all hover:shadow-[0_0_16px_rgba(94,138,133,0.25)] shrink-0"
                      >
                        发送
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-muted/20">
                      {streaming ? "输入意见后点击「打断发言」" : "⌘+Enter 发送 · 可拖拽文件到输入框"}
                    </span>
                    <span className="text-[11px] text-muted/25">
                      {(PHASE_PANEL[currentPhase] ?? ["idea"]).map((r) => ROLE_META[r]?.icon).join(" ")} · {PROVIDER_LABELS[activeProvider]}
                    </span>
                  </div>
                </>
              )}

            </div>
          </div>
          </>
        )}
        </div>

        {/* Right: Sidebar — tools */}
        <aside className={`${currentPhase === "expansion" ? "hidden" : "w-[640px]"} shrink-0 border-l border-border/40 bg-background-warm overflow-y-auto lg:block`}>
          <div className="p-5 space-y-6">
            {/* Roundtable members */}
            <div>
              <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                圆桌成员
              </h3>
              <div className="space-y-2">
                {(PHASE_PANEL[currentPhase] ?? ["idea"]).map((role, i) => {
                  const meta = ROLE_META[role];
                  if (!meta) return null;
                  const descs: Record<string, string> = {
                    idea: "点子发散与收敛",
                    architect: "故事结构与节奏",
                    character: "角色心理与声音",
                    writer: "文笔与场景",
                    editor: "批判审稿与质控",
                    reader: "第一读者视角",
                    continuity: "事实追踪与矛盾检测",
                  };
                  return (
                    <div key={role} className="glass rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
                            {i === 0 && <span className="text-[10px] text-accent/60 px-1.5 py-0.5 bg-accent/10 rounded">主发言</span>}
                          </div>
                          <p className="text-[11px] text-foreground/30 mt-0.5">{descs[role] ?? meta.category}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-foreground/25 mt-2.5">
                你说话后，成员轮流发言并互相讨论。你的纠正会被记住。
              </p>
            </div>

            {/* Independent Writing Tasks */}
            <div>
              <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                独立写作任务
              </h3>
              <div className="space-y-2">
                {[
                  ...(currentPhase === "bible" ? [
                    { kind: "bible_draft", label: "起草 Bible", desc: "角色档案、世界规则、关系张力" },
                    { kind: "bible_revision", label: "按纪要修 Bible", desc: "基于圆桌纪要独立修改" },
                  ] : []),
                  ...(currentPhase === "structure" ? [
                    { kind: "beat_sheet", label: "生成 Beat Sheet", desc: "章节大纲、张力曲线、因果链" },
                    { kind: "beat_revision", label: "按纪要修结构", desc: "保留承重墙并修正中段" },
                  ] : []),
                  ...(currentPhase === "scriptment" ? [
                    { kind: "scriptment", label: "生成 Scriptment", desc: "25-30% 压缩版完整叙事" },
                    { kind: "scriptment_revision", label: "按审稿修 Scriptment", desc: "信息经济、场景功能、跨场景重复" },
                  ] : []),
                ].map((task) => (
                  <button
                    key={task.kind}
                    onClick={() => runWritingTask(task.kind)}
                    disabled={!!writingTaskLoading}
                    className="w-full glass rounded-xl px-4 py-3 text-left hover:bg-surface-hover/50 disabled:opacity-50 transition-colors"
                  >
                    <span className="text-sm font-medium text-foreground/70">
                      {writingTaskLoading === task.kind ? "执行中…" : task.label}
                    </span>
                    <span className="block text-[11px] text-foreground/30 mt-0.5">{task.desc}</span>
                  </button>
                ))}
                {!["bible", "structure", "scriptment"].includes(currentPhase) && (
                  <p className="text-[11px] text-foreground/25 leading-relaxed">
                    构思阶段只做圆桌决策；逐章扩写阶段请进入扩写工作台执行 briefing、写作和审稿循环。
                  </p>
                )}
              </div>
            </div>

            {/* Phase Summaries */}
            <div>
              <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                阶段总结
              </h3>
              <div className="space-y-2">
                {FLOW_STEPS.map((step) => {
                  const hasSummary = !!phaseSummaries[step.key];
                  const isActive = step.key === currentPhase;
                  const isPast = FLOW_STEPS.findIndex((s) => s.key === currentPhase) >
                    FLOW_STEPS.findIndex((s) => s.key === step.key);

                  if (!hasSummary && !isActive && !isPast) return null;

                  return (
                    <div key={step.key}>
                      <button
                        onClick={() => {
                          if (hasSummary) {
                            setSummaryModal({ phase: step.key, text: phaseSummaries[step.key], editing: false });
                          }
                        }}
                        disabled={!hasSummary}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm text-left transition-colors ${
                          hasSummary
                            ? "glass hover:bg-surface-hover/50 cursor-pointer"
                            : "cursor-default"
                        }`}
                      >
                        <span className={hasSummary ? "text-green-400/80" : summaryLoading ? "text-amber-400/60 animate-pulse" : "text-foreground/15"}>
                          {hasSummary ? "✓" : summaryLoading ? "●" : "○"}
                        </span>
                        <span className={hasSummary ? "text-foreground/70 font-medium" : "text-foreground/30"}>
                          {step.label}
                        </span>
                        {hasSummary && (
                          <span className="text-[11px] text-foreground/25 ml-auto">
                            {(phaseSummaries[step.key].length / 1000).toFixed(1)}k字
                          </span>
                        )}
                        {!hasSummary && summaryLoading && (
                          <span className="text-xs text-foreground/30 ml-auto animate-pulse">生成中…</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Clipboard */}
            <div>
              <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                剪贴板 {clips.length > 0 && <span className="text-foreground/25">({clips.length})</span>}
              </h3>
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  <input
                    value={clipInput}
                    onChange={(e) => setClipInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && clipInput.trim()) {
                        saveClip(clipInput.trim(), "human");
                        setClipInput("");
                      }
                    }}
                    placeholder="记点什么..."
                    className="flex-1 bg-surface/50 border border-border/40 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-accent/30 transition-all placeholder:text-muted/20"
                  />
                  <button
                    onClick={() => {
                      if (clipInput.trim()) {
                        saveClip(clipInput.trim(), "human");
                        setClipInput("");
                      }
                    }}
                    className="px-2.5 py-1.5 bg-surface/50 border border-border/40 rounded-lg text-xs text-muted/40 hover:text-foreground hover:border-border-light transition-all"
                  >
                    +
                  </button>
                </div>

                {clips.length > 3 && (
                  <input
                    value={clipSearch}
                    onChange={(e) => setClipSearch(e.target.value)}
                    placeholder="搜索剪贴板..."
                    className="w-full bg-surface/30 border border-border/30 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-accent/30 transition-all placeholder:text-muted/15"
                  />
                )}

                {clips.length === 0 ? (
                  <p className="text-[11px] text-foreground/25 py-2">
                    点消息右上角 📌 保存，或在这里手动添加
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {clips
                      .filter((c) => !clipSearch || c.content.toLowerCase().includes(clipSearch.toLowerCase()))
                      .map((clip) => {
                      const srcMeta = clip.source ? ROLE_META[clip.source] : null;
                      return (
                        <div
                          key={clip.id}
                          className="group glass rounded-lg px-3 py-2 text-xs relative"
                        >
                          {srcMeta && srcMeta.icon && (
                            <span className="text-[10px] text-muted/30 mb-0.5 block">
                              {srcMeta.icon} {srcMeta.label}
                            </span>
                          )}
                          <div className="text-foreground/60 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                            {clip.content}
                          </div>
                          <button
                            onClick={() => deleteClip(clip.id)}
                            className="absolute top-1.5 right-1.5 text-muted/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            {messages.length > 0 && (
              <div>
                <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                  对话统计
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="glass rounded-xl px-4 py-3">
                    <div className="text-xl font-semibold text-foreground/70">
                      {messages.length}
                    </div>
                    <div className="text-[11px] text-foreground/30">总消息</div>
                  </div>
                  <div className="glass rounded-xl px-4 py-3">
                    <div className="text-xl font-semibold text-foreground/70">
                      {msgStats.human ?? 0}
                    </div>
                    <div className="text-[11px] text-foreground/30">你的消息</div>
                  </div>
                </div>

                {/* Participating agents */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(msgStats)
                    .filter(([role]) => role !== "human")
                    .map(([role, count]) => {
                      const meta = ROLE_META[role];
                      if (!meta) return null;
                      return (
                        <span
                          key={role}
                          className="text-[11px] px-2 py-1 glass rounded-full"
                        >
                          {meta.icon} {meta.label}{" "}
                          <span className="text-muted/30">x{count}</span>
                        </span>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </aside>

      {/* Hidden file input for markdown import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importMarkdown(file);
          e.target.value = "";
        }}
      />
      {/* Hidden file input for attachments */}
      <input
        ref={attachInputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.csv,.json,.xml,.html,.js,.ts,.py,.rst,.tex"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addAttachments(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Phase summary modal */}
      {summaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#141e1b] border border-white/10 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-medium text-foreground/80">
                {FLOW_STEPS.find((s) => s.key === summaryModal.phase)?.label ?? summaryModal.phase} — 阶段总结
              </h2>
              <button
                onClick={() => setSummaryModal(null)}
                className="text-foreground/30 hover:text-foreground/60 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              {summaryLoading ? (
                <div className="flex items-center gap-2 text-foreground/40 py-8 justify-center">
                  <span className="animate-pulse">●</span> 正在生成阶段总结…
                </div>
              ) : summaryModal.editing ? (
                <textarea
                  className="w-full h-full min-h-[400px] bg-black/20 border border-white/10 rounded-lg p-4 text-[15px] text-foreground/70 leading-[1.8] resize-none focus:outline-none focus:border-white/20"
                  value={summaryModal.text}
                  onChange={(e) =>
                    setSummaryModal((prev) => prev ? { ...prev, text: e.target.value } : null)
                  }
                />
              ) : (
                <div className="text-[15px] text-foreground/70 whitespace-pre-wrap leading-[1.8]">
                  {summaryModal.text || "（无内容）"}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
              <button
                onClick={() => {
                  if (summaryModal.editing) {
                    savePhaseSummary(summaryModal.phase, summaryModal.text);
                    setSummaryModal((prev) => prev ? { ...prev, editing: false } : null);
                  } else {
                    setSummaryModal((prev) => prev ? { ...prev, editing: true } : null);
                  }
                }}
                disabled={summaryLoading}
                className="text-sm text-foreground/40 hover:text-foreground/60 disabled:opacity-30"
              >
                {summaryModal.editing ? "保存" : "编辑"}
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setSummaryModal(null)}
                  className="px-4 py-2 text-sm text-foreground/40 hover:text-foreground/60"
                >
                  取消
                </button>
                <button
                  onClick={confirmAdvancePhase}
                  disabled={summaryLoading}
                  className="px-4 py-2 text-sm bg-teal-700/40 hover:bg-teal-700/60 text-teal-200/80 rounded-lg disabled:opacity-30"
                >
                  确认进入下一阶段
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
