"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

interface Message {
  id: string;
  role: string;
  model?: string;
  content: string;
  createdAt: string;
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
  { key: "draft", label: "写作", agent: "writer", description: "逐章写作，多模型对比择优" },
  { key: "review", label: "审稿", agent: "editor", description: "四关审稿，控频检查" },
  { key: "final", label: "定稿", agent: "reader", description: "第一读者体验，最终打磨" },
];

// Which agents sit at the table for each phase
const PHASE_PANEL: Record<string, string[]> = {
  conception: ["idea", "architect"],
  bible: ["character", "idea", "architect"],
  structure: ["architect", "writer", "editor"],
  draft: ["writer", "editor"],
  review: ["editor", "reader", "writer"],
  final: ["reader", "editor"],
};

const WELCOME_PROMPTS = [
  "我有一个关于……的故事想法",
  "我想写一个发生在……的故事",
  "我对……这个主题很感兴趣",
];

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
  const [activeProvider, setActiveProvider] = useState("gpt");
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
  const [editingSummary, setEditingSummary] = useState<string | null>(null);
  const [editSummaryText, setEditSummaryText] = useState("");
  const [summaryModal, setSummaryModal] = useState<{ phase: string; text: string; editing: boolean } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/projects`)
      .then((r) => r.json())
      .then((projects: { slug: string; title: string; phase?: string }[]) => {
        const p = projects.find((p) => p.slug === slug);
        if (p) {
          setProjectTitle(p.title);
          if (p.phase) setCurrentPhase(p.phase);
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

  async function loadPhaseSummary(phase: string) {
    const res = await fetch(`/api/phases?projectSlug=${encodeURIComponent(slug)}&phase=${phase}`);
    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        setPhaseSummaries((prev) => ({ ...prev, [phase]: data.content }));
      }
    }
  }

  async function generatePhaseSummary(phase: string) {
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
      }
    } finally {
      setSummaryLoading(false);
    }
  }

  async function savePhaseSummary(phase: string, content: string) {
    await fetch("/api/phases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug: slug, phase, content }),
    });
    setPhaseSummaries((prev) => ({ ...prev, [phase]: content }));
    setEditingSummary(null);
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
    }
  }, [streaming, streamText]);

  // Stream one agent's response, return the text
  async function streamOneAgent(role: string, message: string, skipSaveHuman = false): Promise<string> {
    setStreamingRole(role);
    setStreamText("");
    setThinkingSeconds(0);

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
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API错误 (${res.status}): ${errText}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
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
      }

      return fullText;
    } finally {
      clearInterval(thinkingTimer);
    }
  }

  // Roundtable: send to all agents at the table
  async function send(text?: string) {
    const msg = text ?? input.trim();
    if (!msg || streaming) return;
    setInput("");
    setStreaming(true);
    setError("");
    setSaveStatus("saving");

    const humanMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "human",
      content: msg,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, humanMsg]);

    // Get the panel of agents for current phase
    const panel = PHASE_PANEL[currentPhase] ?? ["idea"];
    let sawPhaseComplete = false;

    try {
      for (let i = 0; i < panel.length; i++) {
        const agentRole = panel[i];
        const isFirst = i === 0;

        // First agent gets the user's actual message
        // Subsequent agents get a prompt to respond to the discussion
        const agentMsg = isFirst
          ? msg
          : `（以上是创作者的消息和其他agent的讨论。请以${ROLE_META[agentRole]?.category ?? agentRole}的专业视角，补充你的意见、提出不同角度、或回应之前agent的观点。简洁有力，不要重复别人说过的。）`;

        const fullText = await streamOneAgent(agentRole, agentMsg, !isFirst);

        const phaseComplete = fullText.includes("[PHASE_COMPLETE]");
        const displayText = fullText.replace(/\n?\[PHASE_COMPLETE\]\n?/g, "").trim();

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

        if (phaseComplete) sawPhaseComplete = true;
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
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

  return (
    <main className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 py-3 flex items-center justify-between relative">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="text-muted/50 hover:text-foreground transition-colors text-sm"
          >
            ← 神仙会
          </a>
          <span className="text-border-light/40">/</span>
          <span className="font-bold text-lg text-gradient-subtle">
            {projectTitle || decodeURIComponent(slug)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Save status */}
          <span className="text-[11px] text-muted/30 mr-1">
            {saveStatus === "saving" && "保存中..."}
            {saveStatus === "saved" && "✓ 已保存"}
          </span>

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

          {/* Roundtable panel */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted/40">圆桌</span>
            <div className="flex gap-1">
              {(PHASE_PANEL[currentPhase] ?? ["idea"]).map((role) => {
                const meta = ROLE_META[role];
                return (
                  <span
                    key={role}
                    className="text-[12px] px-2 py-1 glass rounded-lg"
                    title={meta?.label}
                  >
                    {meta?.icon}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted/40">模型</span>
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value)}
              className="bg-surface/80 border border-border/60 rounded-lg px-2.5 py-1.5 text-sm outline-none hover:border-border-light focus:border-accent/40 transition-colors"
            >
              <option value="gpt">GPT</option>
              <option value="deepseek">DeepSeek</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </div>
        </div>

        {/* Bottom gradient line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border-light/50 to-transparent" />
      </header>

      {/* Main content - split layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat area — 2/3 */}
        <div className="w-2/3 flex flex-col min-w-0">
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

              {/* Message list */}
              {messages.map((m) => {
                const meta = ROLE_META[m.role] ?? {
                  label: m.role,
                  category: m.role,
                  color: "text-muted",
                  icon: "?",
                };
                const isHuman = m.role === "human";
                const isContext = m.role === "context";

                // Context messages — collapsible card
                if (isContext) {
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
                  <div key={m.id} {...(isHuman ? { "data-human-msg": true } : {})} className={`group/msg ${isHuman ? "flex justify-end" : ""}`}>
                    <div
                      className={`relative ${
                        isHuman
                          ? "max-w-2xl bg-accent/8 border border-accent/10 rounded-2xl rounded-br-sm px-5 py-3"
                          : "max-w-3xl"
                      }`}
                    >
                      {!isHuman && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm">{meta.icon}</span>
                          <span
                            className={`text-xs font-medium ${meta.color}`}
                          >
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
                      )}
                      {isHuman && (
                        <button
                          onClick={() => deleteMessage(m.id)}
                          className="absolute -left-6 top-3 text-[11px] text-muted/15 hover:text-red-400 opacity-0 group-hover/msg:opacity-100 transition-all"
                          title="删除此消息"
                        >
                          ✕
                        </button>
                      )}
                      <div className="whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground/85">
                        {m.content}
                      </div>
                    </div>
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
                  <div className="whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground/85">
                    {streamText}
                    <span className="animate-pulse text-accent">▍</span>
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
              <div className="flex gap-3 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="说点什么..."
                  disabled={streaming}
                  rows={1}
                  className="flex-1 bg-surface/60 border border-border/60 rounded-xl px-4 py-3 outline-none focus:border-accent/30 text-[15px] disabled:opacity-40 resize-none min-h-[48px] max-h-[200px] transition-all placeholder:text-muted/25 focus:bg-surface/80 focus:shadow-[0_0_20px_rgba(94,138,133,0.06)]"
                />
                <button
                  onClick={() => send()}
                  disabled={streaming || !input.trim()}
                  className="px-6 py-3 bg-accent/80 hover:bg-accent disabled:bg-surface/40 disabled:text-muted/30 rounded-xl text-sm font-medium transition-all hover:shadow-[0_0_16px_rgba(94,138,133,0.25)] shrink-0"
                >
                  发送
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-muted/20">
                  ⌘+Enter 发送
                </span>
                <span className="text-[11px] text-muted/25">
                  {(PHASE_PANEL[currentPhase] ?? ["idea"]).map((r) => ROLE_META[r]?.icon).join(" ")} · {PROVIDER_LABELS[activeProvider]}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Sidebar — 1/3 */}
        <aside className="w-1/3 border-l border-border/40 bg-background-warm shrink-0 overflow-y-auto hidden lg:block">
          <div className="p-6 space-y-7">
            {/* Flow progress */}
            <div>
              <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                创作流程
              </h3>
              <div className="space-y-1">
                {FLOW_STEPS.map((step) => {
                  const isActive = step.key === currentPhase;
                  const isPast = FLOW_STEPS.findIndex((s) => s.key === currentPhase) >
                    FLOW_STEPS.findIndex((s) => s.key === step.key);
                  const stepMeta = ROLE_META[step.agent];

                  return (
                    <button
                      key={step.key}
                      onClick={() => setPhase(step.key)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-all ${
                        isActive
                          ? "bg-accent/10 border border-accent/25"
                          : isPast
                          ? "text-foreground/35 hover:bg-surface-hover/40"
                          : "text-foreground/20 hover:bg-surface-hover/30"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-2 h-2 rounded-full transition-colors ${
                            isActive
                              ? "bg-accent shadow-[0_0_8px_rgba(94,138,133,0.5)]"
                              : isPast
                              ? "bg-foreground/20"
                              : "bg-foreground/10"
                          }`}
                        />
                        <span
                          className={
                            isActive
                              ? "text-accent font-medium"
                              : ""
                          }
                        >
                          {stepMeta?.icon} {step.label}
                        </span>
                        {isPast && <span className="text-[10px] text-foreground/20 ml-auto">done</span>}
                      </div>
                      {isActive && (
                        <p className="text-[12px] text-foreground/35 mt-1 ml-[18px]">
                          {step.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              {FLOW_STEPS.findIndex((s) => s.key === currentPhase) < FLOW_STEPS.length - 1 && (
                <button
                  onClick={startPhaseTransition}
                  disabled={summaryLoading}
                  className="mt-3 w-full px-3.5 py-2.5 text-sm text-accent/80 hover:text-accent bg-accent/8 hover:bg-accent/15 border border-accent/20 rounded-xl transition-all disabled:opacity-50"
                >
                  {summaryLoading ? "生成总结中..." : "进入下一阶段 →"}
                </button>
              )}
            </div>

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
                你说一句话，所有成员自动轮流发言
              </p>
            </div>

            {/* Phase Summaries */}
            <div>
              <h3 className="text-xs text-foreground/40 font-medium tracking-wide mb-3">
                阶段总结
              </h3>
              <div className="space-y-2">
                {FLOW_STEPS.map((step) => {
                  const hasSummary = !!phaseSummaries[step.key];
                  const isEditing = editingSummary === step.key;
                  const isActive = step.key === currentPhase;
                  const isPast = FLOW_STEPS.findIndex((s) => s.key === currentPhase) >
                    FLOW_STEPS.findIndex((s) => s.key === step.key);

                  if (!hasSummary && !isActive && !isPast) return null;

                  return (
                    <div key={step.key}>
                      <details className="group">
                        <summary className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                          hasSummary
                            ? "glass hover:bg-surface-hover/50"
                            : "hover:bg-surface-hover/30"
                        }`}>
                          <span className={hasSummary ? "text-green-400/80" : "text-foreground/15"}>
                            {hasSummary ? "✓" : "○"}
                          </span>
                          <span className={hasSummary ? "text-foreground/70 font-medium" : "text-foreground/30"}>
                            {step.label}
                          </span>
                          {hasSummary && (
                            <span className="text-[11px] text-foreground/25 ml-auto">
                              {(phaseSummaries[step.key].length / 1000).toFixed(1)}k字
                            </span>
                          )}
                        </summary>
                        <div className="mt-2 rounded-xl overflow-hidden">
                          {hasSummary ? (
                            isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editSummaryText}
                                  onChange={(e) => setEditSummaryText(e.target.value)}
                                  className="w-full bg-surface/60 border border-border/50 rounded-xl px-4 py-3 text-xs text-foreground/60 leading-relaxed outline-none focus:border-accent/30 resize-none"
                                  rows={14}
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => savePhaseSummary(step.key, editSummaryText)}
                                    className="px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={() => setEditingSummary(null)}
                                    className="px-3 py-1.5 text-xs text-foreground/35 bg-surface-hover/50 rounded-lg hover:text-foreground/50 transition-colors"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="relative">
                                <div className="glass rounded-xl px-4 py-3 max-h-60 overflow-y-auto text-[12px] text-foreground/45 leading-relaxed whitespace-pre-wrap">
                                  {phaseSummaries[step.key]}
                                </div>
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => {
                                      setEditingSummary(step.key);
                                      setEditSummaryText(phaseSummaries[step.key]);
                                    }}
                                    className="text-[11px] text-foreground/25 hover:text-accent transition-colors"
                                  >
                                    编辑
                                  </button>
                                  <button
                                    onClick={() => generatePhaseSummary(step.key)}
                                    disabled={summaryLoading}
                                    className="text-[11px] text-foreground/25 hover:text-accent disabled:text-foreground/10 transition-colors"
                                  >
                                    {summaryLoading ? "生成中..." : "重新生成"}
                                  </button>
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="px-3.5 py-2">
                              {(isActive || isPast) && messages.length > 0 && (
                                <button
                                  onClick={() => generatePhaseSummary(step.key)}
                                  disabled={summaryLoading}
                                  className="text-xs text-accent/70 hover:text-accent disabled:text-foreground/15 transition-colors"
                                >
                                  {summaryLoading ? "生成中..." : "生成总结"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </details>
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
      </div>
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

      {/* Phase summary modal */}
      {summaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#141e1b] border border-white/10 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
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
                  className="w-full h-full min-h-[300px] bg-black/20 border border-white/10 rounded-lg p-4 text-sm text-foreground/70 resize-none focus:outline-none focus:border-white/20"
                  value={summaryModal.text}
                  onChange={(e) =>
                    setSummaryModal((prev) => prev ? { ...prev, text: e.target.value } : null)
                  }
                />
              ) : (
                <div className="text-sm text-foreground/60 whitespace-pre-wrap leading-relaxed">
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
