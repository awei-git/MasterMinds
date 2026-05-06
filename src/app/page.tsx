"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Project {
  id: string;
  slug: string;
  title: string;
  type: string;
  phase: string;
  status: string;
  updatedAt: string;
}

const PHASE_LABELS: Record<string, string> = {
  conception: "构思",
  bible: "世界与角色",
  structure: "结构",
  scriptment: "全文速写",
  expansion: "逐章扩写",
  draft: "逐章扩写",
  review: "逐章扩写",
  revision: "逐章扩写",
  final: "逐章扩写",
};

const PHASE_COLORS: Record<string, string> = {
  conception: "bg-teal-500/10 text-teal-300/80 border-teal-500/15",
  bible: "bg-slate-500/10 text-slate-300 border-slate-500/15",
  structure: "bg-cyan-500/10 text-cyan-300/80 border-cyan-500/15",
  scriptment: "bg-sky-500/10 text-sky-300/80 border-sky-500/15",
  expansion: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/15",
  draft: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/15",
  review: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/15",
  revision: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/15",
  final: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/15",
};

const AGENTS = [
  { icon: "💡", name: "点子", alias: "灵犀", desc: "苏格拉底式brainstorm，打磨核心创意", color: "from-teal-500/15 to-transparent" },
  { icon: "🏗", name: "结构", alias: "鲁班", desc: "故事骨架、节拍表、中段防塌", color: "from-cyan-500/15 to-transparent" },
  { icon: "🎭", name: "角色", alias: "画皮", desc: "角色心理设计、声音DNA、关系矩阵", color: "from-slate-500/15 to-transparent" },
  { icon: "✍", name: "写手", alias: "妙笔", desc: "逐章写作，多模型同写择优", color: "from-emerald-500/15 to-transparent" },
  { icon: "📝", name: "编辑", alias: "铁面", desc: "四关审稿、控频检查、不留情面", color: "from-sky-500/15 to-transparent" },
  { icon: "📖", name: "读者", alias: "知音", desc: "模拟真实读者的第一手阅读体验", color: "from-zinc-500/15 to-transparent" },
  { icon: "🔗", name: "连续性", alias: "掌故", desc: "事实追踪、时间线、矛盾检测", color: "from-slate-500/15 to-transparent" },
];

const FLOW = [
  { label: "构思", desc: "冲突 · 主题 · Logline", icon: "◇" },
  { label: "世界与角色", desc: "角色档案 · 世界观", icon: "◈" },
  { label: "结构", desc: "节拍表 · 张力曲线", icon: "▣" },
  { label: "全文速写", desc: "Scriptment · 信息经济", icon: "▤" },
  { label: "逐章扩写", desc: "Briefing · 写作 · 审稿", icon: "◎" },
];

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"novel" | "screenplay">("novel");
  const [createError, setCreateError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects);
  }, []);

  // Load archived projects when the section is opened
  useEffect(() => {
    if (showArchived) {
      fetch("/api/projects?archived=1")
        .then((r) => r.json())
        .then(setArchivedProjects);
    }
  }, [showArchived]);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreateError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "创建失败");
        return;
      }
      setShowNew(false);
      setTitle("");
      router.push(`/project/${data.slug}`);
    } catch {
      setCreateError("网络错误，请重试");
    }
  }

  // "删除" on active project = archive it (safe, reversible)
  async function handleArchive(slug: string) {
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, action: "archive" }),
    });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.slug !== slug));
      setConfirmArchive(null);
      // Refresh archived list if visible
      if (showArchived) {
        fetch("/api/projects?archived=1")
          .then((r) => r.json())
          .then(setArchivedProjects);
      }
    }
  }

  // Restore archived project
  async function handleUnarchive(slug: string) {
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, action: "unarchive" }),
    });
    if (res.ok) {
      setArchivedProjects((prev) => prev.filter((p) => p.slug !== slug));
      // Refresh active list
      fetch("/api/projects")
        .then((r) => r.json())
        .then(setProjects);
    }
  }

  // Permanent delete — only available for archived projects
  async function handlePermanentDelete(slug: string) {
    await fetch(`/api/projects?slug=${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    setArchivedProjects((prev) => prev.filter((p) => p.slug !== slug));
    setConfirmDelete(null);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <div className="relative overflow-hidden">
        {/* Background gradient orbs */}
        <div className="absolute top-[-200px] left-[-100px] w-[500px] h-[500px] rounded-full bg-accent/5 blur-[120px]" />
        <div className="absolute top-[-100px] right-[-200px] w-[600px] h-[400px] rounded-full bg-gold-dim blur-[100px]" />

        <div className="relative max-w-7xl mx-auto px-8 pt-16 pb-12">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="font-brush text-6xl tracking-wide text-gradient leading-tight">
                神仙会
              </h1>
              <p className="text-muted/60 text-xs mt-2 tracking-[0.3em] uppercase font-light">
                MasterMinds
              </p>
              <p className="text-muted mt-5 text-lg leading-relaxed">
                长篇创作工作室
                <span className="text-muted/40 mx-2">—</span>
                <span className="text-foreground/50">从一颗种子到一本书</span>
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => { setShowNew(!showNew); setCreateError(""); }}
                className="px-6 py-3 bg-accent/90 hover:bg-accent text-white rounded-xl text-sm font-medium transition-all hover:shadow-[0_0_24px_rgba(94,138,133,0.3)]"
              >
                + 新建项目
              </button>
            </div>
          </div>
        </div>

        {/* Divider line with gradient */}
        <div className="h-px bg-gradient-to-r from-transparent via-border-light to-transparent" />
      </div>

      {/* New project modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowNew(false)}
          />
          {/* Modal */}
          <div className="relative w-full max-w-lg mx-4 p-8 glass rounded-2xl glow-accent noise">
            <h3 className="text-xl font-bold mb-6 text-gradient-subtle">
              开始一个新故事
            </h3>
            <input
              autoFocus
              placeholder="给你的故事起个名字..."
              value={title}
              onChange={(e) => { setTitle(e.target.value); setCreateError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-full bg-transparent border-b border-border-light pb-3 mb-2 outline-none text-xl placeholder:text-muted/30 focus:border-accent/60 transition-colors"
            />
            {createError && (
              <p className="text-red-400/80 text-sm mb-4">{createError}</p>
            )}
            {!createError && <div className="mb-4" />}
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-xs text-muted/60 mb-1.5 tracking-wider">类型</label>
                <select
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as "novel" | "screenplay")
                  }
                  className="bg-surface-hover/60 border border-border-light rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/40 transition-colors"
                >
                  <option value="novel">小说</option>
                  <option value="screenplay">剧本</option>
                </select>
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 text-muted hover:text-foreground text-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!title.trim()}
                className="px-7 py-2.5 bg-accent/90 hover:bg-accent disabled:bg-surface-hover disabled:text-muted rounded-xl text-sm font-medium transition-all hover:shadow-[0_0_16px_rgba(94,138,133,0.25)]"
              >
                开始创作
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-10">
        <div className="flex gap-10">
          {/* Left: Projects */}
          <div className="flex-1 min-w-0">
            <h2 className="text-xs font-medium text-muted/50 uppercase tracking-[0.2em] mb-5">
              项目
            </h2>

            {projects.length === 0 ? (
              <div className="text-center py-24 glass rounded-2xl relative noise">
                <div className="text-4xl mb-4 opacity-30">✦</div>
                <p className="text-muted text-lg mb-2">还没有项目</p>
                <p className="text-muted/40 text-sm">
                  点击右上角「新建项目」开始你的第一个长篇
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="group relative glass rounded-2xl hover:border-border-light transition-all duration-300 hover:glow-accent overflow-hidden"
                  >
                    {/* Subtle left accent bar */}
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-accent/40 via-accent/10 to-transparent" />

                    <button
                      onClick={() => router.push(`/project/${p.slug}`)}
                      className="w-full text-left p-6 pl-5"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-muted/50 bg-surface-hover/80 px-2 py-0.5 rounded border border-border/60 shrink-0 tracking-wider">
                          {p.type === "novel" ? "小说" : "剧本"}
                        </span>
                        <span className="text-lg font-bold group-hover:text-gradient-subtle transition-colors">
                          {p.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-3 ml-[3.5rem]">
                        <span
                          className={`text-[11px] px-2.5 py-0.5 rounded-full border ${
                            PHASE_COLORS[p.phase] ?? "bg-surface-hover text-muted border-border"
                          }`}
                        >
                          {PHASE_LABELS[p.phase] ?? p.phase}
                        </span>
                        <span className="text-[11px] text-muted/40">
                          最后更新 {new Date(p.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </button>

                    {/* Action: archive (shown as "删除") */}
                    <div className="absolute top-4 right-4 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {confirmArchive === p.slug ? (
                        <span className="flex gap-1 items-center">
                          <span className="text-[11px] text-muted/40 mr-1">项目将被归档</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchive(p.slug);
                            }}
                            className="px-2.5 py-1 text-[11px] text-red-400 bg-red-900/20 rounded-lg border border-red-500/20 transition-all"
                          >
                            确认
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmArchive(null);
                            }}
                            className="px-2.5 py-1 text-[11px] text-muted bg-surface-hover/80 rounded-lg border border-border/40"
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmArchive(p.slug);
                          }}
                          className="px-2.5 py-1 text-[11px] text-muted/60 hover:text-red-400 bg-surface-hover/80 hover:bg-red-900/15 rounded-lg border border-border/40 hover:border-red-500/20 transition-all"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Archived projects — separate fetch, hidden by default */}
            <div className="mt-8">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="text-xs text-muted/40 hover:text-muted transition-colors mb-3 flex items-center gap-1.5"
              >
                <span className={`text-[10px] transition-transform duration-200 ${showArchived ? "rotate-90" : ""}`}>
                  ▶
                </span>
                已归档
                {archivedProjects.length > 0 && ` (${archivedProjects.length})`}
              </button>

              {showArchived && (
                <div className="space-y-2">
                  {archivedProjects.length === 0 && (
                    <p className="text-[11px] text-muted/25 py-2 pl-4">没有归档项目</p>
                  )}
                  {archivedProjects.map((p) => (
                    <div
                      key={p.id}
                      className="group relative p-4 bg-surface/30 rounded-xl border border-border/40 opacity-60 hover:opacity-100 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted group-hover:text-foreground transition-colors">
                          {p.title}
                        </span>
                        <span className="text-[11px] text-muted/40">
                          {new Date(p.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>

                      <div className="absolute top-2.5 right-24 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnarchive(p.slug);
                          }}
                          className="px-2 py-1 text-[11px] text-muted hover:text-accent bg-surface-hover/60 rounded-lg transition-colors"
                        >
                          恢复
                        </button>
                        {confirmDelete === p.slug ? (
                          <span className="flex gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePermanentDelete(p.slug);
                              }}
                              className="px-2 py-1 text-[11px] text-red-400 bg-red-900/20 rounded-lg"
                            >
                              永久删除
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDelete(null);
                              }}
                              className="px-2 py-1 text-[11px] text-muted bg-surface-hover/60 rounded-lg"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(p.slug);
                            }}
                            className="px-2 py-1 text-[11px] text-muted hover:text-red-400 bg-surface-hover/60 rounded-lg transition-colors"
                          >
                            彻底删除
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Info panels */}
          <div className="w-[420px] shrink-0 space-y-8 hidden lg:block">
            {/* Workflow */}
            <div>
              <h2 className="text-xs font-medium text-muted/50 uppercase tracking-[0.2em] mb-4">
                创作流程
              </h2>
              <div className="glass rounded-2xl p-5 relative noise">
                <div className="space-y-0.5">
                  {FLOW.map((step, i) => (
                    <div
                      key={step.label}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-hover/30 transition-colors"
                    >
                      <span className="text-accent/40 text-sm w-5 text-center font-mono">
                        {step.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground/80">{step.label}</span>
                        <span className="text-xs text-muted/40 ml-2">{step.desc}</span>
                      </div>
                      <span className="text-[10px] text-muted/25 font-mono">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Agent team */}
            <div>
              <h2 className="text-xs font-medium text-muted/50 uppercase tracking-[0.2em] mb-4">
                创作团队
              </h2>
              <div className="glass rounded-2xl overflow-hidden relative noise">
                {AGENTS.map((a, i) => (
                  <div
                    key={a.name}
                    className={`flex items-start gap-3 px-5 py-3.5 hover:bg-surface-hover/20 transition-colors relative ${
                      i < AGENTS.length - 1 ? "border-b border-border/40" : ""
                    }`}
                  >
                    {/* Subtle gradient from left */}
                    <div className={`absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r ${a.color} opacity-0 hover:opacity-100 transition-opacity`} />
                    <span className="text-lg mt-0.5 relative z-10">{a.icon}</span>
                    <div className="min-w-0 relative z-10">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-medium text-foreground/90">{a.name}</span>
                        <span className="text-[11px] text-muted/35">「{a.alias}」</span>
                      </div>
                      <p className="text-xs text-muted/50 mt-0.5 leading-relaxed">
                        {a.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Models */}
            <div>
              <h2 className="text-xs font-medium text-muted/50 uppercase tracking-[0.2em] mb-4">
                多模型引擎
              </h2>
              <div className="glass rounded-2xl p-5 relative noise">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: "GPT 5.5", role: "讨论 · brainstorm", accent: "border-l-teal-500/30" },
                    { name: "DeepSeek", role: "讨论 · brainstorm", accent: "border-l-cyan-500/30" },
                    { name: "Claude", role: "审稿 · review", accent: "border-l-slate-400/30" },
                    { name: "Gemini 3.1", role: "写作 · 备选", accent: "border-l-emerald-500/30" },
                  ].map((m) => (
                    <div
                      key={m.name}
                      className={`px-3 py-2.5 rounded-lg bg-surface-hover/20 border-l-2 ${m.accent}`}
                    >
                      <div className="text-sm font-medium text-foreground/80">{m.name}</div>
                      <div className="text-[11px] text-muted/40">{m.role}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted/30 mt-4 leading-relaxed">
                  同一内容多模型同写，人类择优选用
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
