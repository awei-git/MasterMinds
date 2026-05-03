# 神仙会 (Masterminds) — 长篇创作工程化平台

## 定位

独立产品。专做中长篇小说和剧本——周期长、结构复杂、需要多角色持续协作。

Mira 负责短文（essay、blog、短篇）。神仙会从 Mira writer 继承写作基础设施（skills、frameworks、checklists），架构完全独立。

## 核心理念

**编剧室模型 (Writers' Room)**

- **你 = Showrunner**：提出想法，在讨论中给建议，确认共识，拍板推进
- **Agents = 编剧室成员**：围绕议题短促发言、争论、收敛
- **史官 = 会议记录**：每段讨论后独立归纳纪要，传递给下一步
- **App = 编剧室本身**：看板、讨论面板、稿件、资料库

---

## Agent Teams

### 核心角色

| 角色 | 代号 | 职责 |
|------|------|------|
| **故事建筑师** | architect / 鲁班 | 结构、节奏、情节弧线、beat sheet |
| **角色总监** | character / 画皮 | 角色心理、声音一致性、关系网络 |
| **写手** | writer / 妙笔 | 实际写作——逐章散文 |
| **主编** | editor / 铁面 | 多层级审稿：结构、语言、信息经济 |
| **第一读者** | reader / 知音 | 翻页欲望、哪里无聊、哪里困惑 |
| **连续性检查** | continuity / 掌故 | 事实追踪、时间线、前后一致性 |
| **史官** | chronicler / 史官 | 讨论纪要归纳（不参与讨论本身） |

### Agent 实现

每个 agent 是一个角色定义 + 专属 prompt + 专属 skills + 上下文窗口策略。不是独立进程，而是按需调用的角色模板。

关键区别：
1. **上下文构建不同**：writer 需要 scriptment + 前序章节 + briefing；editor 需要全局视角 + 骨架对比
2. **输出格式不同**：讨论时输出要点（≤3条），写作时输出散文，审稿时输出结构化 review
3. **调用时机不同**：有的每章调用，有的只在 phase 转换时调用

---

## 工作流：5 个 Phase

```
Phase 1: Conception（构思）
Phase 2: Bible（世界与角色）
Phase 3: Structure（结构）
Phase 4: Scriptment（全文速写）
Phase 5: Expansion（逐章扩写）
```

每个 Phase 的模式相同：

```
讨论（Roundtable） → 史官归纳 → 用户确认纪要
                                      ↓
                              写作任务（独立执行）
                                      ↓
                              用户审阅成果 → 满意则推进 / 不满意则再开讨论
```

**讨论和写作严格分离。讨论只做决策（要点），写作单独执行（散文/大纲/beat sheet）。**

### Phase 1: Conception — 构思

**目标**：锁定 logline、核心冲突、主题。

```
用户提出种子 idea
    ↓
Roundtable 讨论
  参与者: idea, architect, character
  议题: 核心冲突、主题、结构可行性
  用户随时插话
    ↓
史官归纳 → 纪要
    ↓
用户确认 → Phase 2
```

### Phase 2: Bible — 世界与角色

**目标**：锁定角色档案（want/need/flaw/ghost/voice DNA）、世界设定、规则。

```
系统基于 Phase 1 共识起草角色初稿（写作任务）
    ↓
Roundtable 讨论
  参与者: character, idea, architect
  议题: 角色矛盾是否锐利、关系是否产生张力、能否支撑结构
    ↓
史官归纳 → 纪要
    ↓
Character 独立修改角色档案（写作任务）
    ↓
用户确认 → Phase 3
```

### Phase 3: Structure — 结构

**目标**：锁定 beat sheet、章节大纲、张力曲线。

```
Architect 独立生成初始 beat sheet（写作任务）
    ↓
Roundtable 讨论
  参与者: architect, editor, reader
  议题: 中段是否塌陷、信息密度、翻页欲望预判
    ↓
史官归纳 → 纪要
    ↓
Architect 独立修改 beat sheet（写作任务）
    ↓
用户确认 → Phase 4
```

### Phase 4: Scriptment — 全文速写

**目标**：用目标字数的 25-30% 写一个完整的、可读的叙事。不是大纲，不是摘要——是压缩版的故事。

**为什么需要这一步**：
- 一个模型一次 pass 写完全文，天然不会重复信息（被子补丁只出现一次）
- 在 4000 字上修结构，比在 15000 字上修便宜 10 倍
- Scriptment 就是扩写阶段的骨架

```
单模型单 pass 生成 scriptment（写作任务）
  输入: beat sheet + bible + style guide
  输出: scriptment.md（目标字数 × 25%）
  规则: 包含每个场景的核心动作、关键对话、重要意象、转场
    ↓
Roundtable: 结构审稿讨论
  参与者: editor, reader, architect
  议题: 信息经济、场景功能、跨场景重复（三个新维度）
    ↓
史官归纳 → 纪要
    ↓
用户根据纪要修改 scriptment（可直接编辑 / 让模型改）
    ↓
可以再跑一轮讨论 → 满意后确认 → Phase 5
```

#### 结构审稿三维度（Phase 4 特有）

当前审稿缺失的关键检查，在 scriptment 结构审稿中强制执行：

**1. 信息经济检测**
逐场景列出：该场景给读者的新信息是什么？已出现过的信息标记 [REDUNDANT]。三次以上重复标记 [P0-REDUNDANT]。

**2. 场景功能检查**
每个场景必须推进至少两个维度（剧情推进 / 人物深化 / 氛围主题 / 悬念设置解答）。只推进一个维度标记 [WEAK-SCENE]，零维度标记 [P0-NO-FUNCTION]。

**3. 跨场景重复扫描**
相同的物理动作/意象/对话在不同场景中重复出现：第一次正常，第二次标记 [ECHO]（判断是否有意回旋），第三次标记 [P0-REPETITION]。

### Phase 5: Expansion — 逐章扩写

**目标**：以 scriptment 为骨架，逐章扩写到完整散文。

**关键设计**：
- 写作单位是**章（chapter）**，不是 beat
- 每章都能看到**全局上下文**：scriptment 全文 + 已完成的前序章节
- Review 集成在扩写循环里，不是独立 phase

```
对每一章：

  Pre-Briefing Roundtable（轻量，1轮）
    参与者: character, architect
    character: 出场角色声音 DNA + 关系状态 + 不要重复的细节
    architect: 本章结构功能 + 上下章衔接 + scriptment 对应段落
      ↓
  Writer 独立扩写（写作任务）
    输入: scriptment 全文 + 已完成前序章节（最近2章全文，更早的用摘要）
          + bible 中本章相关角色/设定 + briefing + style guide
      ↓
  Post-Review Roundtable（轻量，1轮）
    参与者: editor, character
    editor: 骨架对齐 + 语言问题 + 字数
    character: 声音一致性验证
      ↓
  史官归纳
      ↓
  通过 → 下一章
  有问题 → writer 修改（看到讨论纪要）→ 再审（最多 3 轮）
```

全部章节完成后，可选终审：

```
Optional: Full Review Roundtable
  参与者: editor, character, reader, continuity
  素材: 全文
  输出: 跨章协调修改计划（不是逐章独立修改）
  用户确认修改计划后执行
```

---

## Roundtable 讨论机制

这是神仙会的核心——不是 agent 默默干活交作业，而是**可见的、有来有回的短促讨论**。

### 发言规则

```
你在开会，不是写报告。

1. 每次发言不超过 3 个要点，每个要点一句话
2. 同意就说"同意"，不要复述别人的观点
3. 不同意就说清楚哪里不同意，一句话说理由
4. 不要输出示例文本、不要写段落、不要展开论述
5. 具体的文本写作在讨论之外单独做，讨论只做决策
6. 回应前面的人再说你自己的，不要忽略别人的发言
7. 用你的角色视角说话，不要当万能评论员

格式：
- 要点一
- 要点二
- （如有分歧）但是：xxx
```

### 执行协议

```
Round 1:
  Agent A 发言（看到 素材）
  Agent B 发言（看到 素材 + A 的发言）
  Agent C 发言（看到 素材 + A + B 的发言）
  用户可在任意 agent 发言后插话，后续 agent 看到用户发言

检测分歧：
  所有人一致 → 1 轮结束
  有分歧 → Round 2（每人看到 Round 1 所有发言 + 用户插话）

Round 2:
  各人回应分歧
  仍有硬分歧 → 标记待用户裁决

讨论结束 → 史官归纳
```

### 用户参与方式

- **插话**：讨论进行中随时"举手"，暂停讨论，输入意见，后续 agent 看到
- **裁决**：有分歧时，用户选择支持哪方
- **确认纪要**：史官归纳后，用户确认纪要，然后推进

### 速度控制

后端全速生成，前端通过缓冲区控制渲染速度：

| 模式 | 每字延迟 | 发言间停顿 | 体验 |
|------|---------|-----------|------|
| realtime | 30ms | 2s | 像看真人开会 |
| fast | 10ms | 500ms | 快速阅读 |
| instant | 0 | 0 | 直接显示结果 |

用户可以随时切换速度。暂停 = 停止渲染（后端继续生成）。

### 史官归纳

每段讨论结束后，所有讨论 agent 退场，**史官（chronicler）**独立归纳。

史官输入：完整讨论记录。
史官输出：

```markdown
## 共识
- （所有人同意的决策，每条一句话）

## 分歧（如有）
- 议题：xxx
  - 甲方（谁）：xxx
  - 乙方（谁）：xxx
  - 创作者裁决：xxx

## 待办
- （下一步需要执行的具体动作）

## 约束（新增的硬规则）
- （本次讨论新确立的不可违反的规则）
```

**Agents 之间永远不传递原始讨论记录。传递的是史官纪要。** 这保证：
- Context 窗口小（纪要 200 字 vs 讨论 2000 字）
- 信息精准（只有决策和约束）
- 不会有 agent "回应"之前讨论的某句话导致跑偏

### Agenda 系统

每个讨论有预设议程，定义参与者、发言角度、推进条件：

```
conception:
  参与者: idea → architect → character
  角度:
    idea: 从种子出发，核心冲突和主题可以是什么
    architect: 这个冲突能支撑多长叙事？结构机会和风险
    character: 什么角色能最大化冲突张力
  推进条件: logline + theme + core conflict agreed

bible:
  参与者: character → idea → architect
  角度:
    character: want/need/flaw/ghost 是否锐利，声音是否区分
    idea: 角色关系是否产生足够张力
    architect: 角色能否支撑 beat sheet 关键转折点
  推进条件: character profiles + relationship map agreed

structure:
  参与者: architect → editor → reader
  角度:
    architect: 节拍表、章节大纲、中段加固
    editor: 结构弱点、信息密度、节奏隐患
    reader: 翻页欲望预判、哪里可能走神
  推进条件: beat sheet agreed, no P0 structural issues

structural_review:
  参与者: editor → reader → architect
  角度:
    editor: 信息经济 + 场景功能 + 跨场景冗余
    reader: 验证/争议 editor 判断 + 翻页欲望曲线
    architect: 针对问题提出具体结构修改方案
  推进条件: no P0 redundancy or structural issues

pre_briefing:
  参与者: character → architect
  轮数: 1（轻量）
  角度:
    character: 出场角色声音 DNA + 关系状态 + 不要重复的细节
    architect: 本章结构功能 + 上下章衔接
  推进条件: always advance

chapter_review:
  参与者: editor → character
  轮数: 1
  角度:
    editor: 骨架对齐 + 语言问题 + 字数
    character: 声音一致性验证
  推进条件: no P0 issues
```

---

## 项目知识库

```
data/{project}/
├── meta/
│   └── project.json              # 状态、phase、配置
├── bible/
│   ├── world.md                  # 世界设定
│   ├── characters/
│   │   ├── {name}.md             # 角色档案
│   │   └── relationships.md      # 关系网络
│   ├── locations.md
│   └── rules.md
├── structure/
│   ├── beats.md                  # 节拍表
│   └── outline.md                # 章节大纲
├── scriptment/
│   ├── scriptment.md             # 全文速写
│   └── approved.md               # 用户确认的定稿版
├── draft/
│   ├── ch01.md                   # 扩写后的完整章节
│   ├── ch02.md
│   └── ...
├── discussions/
│   └── {id}.json                 # 讨论记录（原始发言）
├── summaries/
│   └── {discussion_id}.md        # 史官纪要
├── phases/
│   └── {phase}.md                # 每个 phase 的锁定决策
├── continuity/
│   ├── facts.json
│   ├── character-states.json
│   └── timeline.json
└── memory/
    ├── project-memory.md         # 创作过程中的认知
    ├── style-guide.md            # 逐渐成型的风格指南
    ├── decisions.md              # 关键决策日志
    └── agent-notes/
        ├── architect.md
        ├── character.md
        ├── writer.md
        └── editor.md
```

### 上下文窗口策略

每次调用 agent 时，根据角色和任务动态组装 context：

| 任务 | 必须包含 | 可选 |
|------|----------|------|
| 讨论发言 | 角色定义 + 议程 + 素材 + 前人发言 + 相关纪要 | agent notes |
| 写 scriptment | beat sheet + bible + style guide + 纪要中的约束 | framework |
| 扩写第 N 章 | scriptment 全文 + briefing + 前 2 章全文 + 更早章摘要 + bible | style guide |
| 章节审稿 | scriptment 对应段落 + 章节原文 + briefing | continuity |
| 史官归纳 | 完整讨论记录 | 无 |

**核心原则**：不把所有东西塞进 context，精确组装该任务需要的切片。agents 之间传递纪要，不传递原始讨论。

---

## 记忆系统

### 层级

1. **项目记忆 (project-memory.md)**：创作偏好、方向、人类的审美倾向
2. **风格指南 (style-guide.md)**：从写作过程中沉淀，不是预设
3. **决策日志 (decisions.md)**：关键决策 + 理由 + 上下文
4. **Agent 笔记 (agent-notes/)**：每个角色在项目中积累的专业视角
5. **讨论纪要 (summaries/)**：史官归纳的结构化纪要
6. **全局记忆 (data/global-memory.md)**：跨项目的创作偏好

### 生命周期

```
讨论纪要 → 确认后写入 phase summary（硬约束）
Agent 完成任务后 → 更新 agent notes
用户 review 后 → 提取偏好到 style-guide 和 project-memory
Phase 完成后 → 纪要中的约束写入 phase summary
项目完成后 → 有价值的部分并入 global memory
```

### 和知识库的关系

```
知识库 (What)                      记忆 (Why + How)
───────────                        ──────────────
bible: 世界和角色设定               project-memory: 为什么选择这样的世界
structure: beat sheet               decisions: 为什么这样安排
scriptment: 压缩版故事              style-guide: 怎样的文字是对的
draft: 完整散文                     summaries: 讨论中的决策和约束
continuity: 事实数据库              agent-notes: 各角色的工作笔记
```

---

## Interface

整个 app 一个主界面，三个区域：进度条 + 主面板 + 输入区。

### 进度条（左侧）

```
● 构思 ✓     ← 点击查看该阶段纪要
● 角色 ✓
◐ 结构 ←     ← 当前阶段
○ 速写
○ 扩写
─────────
📊 概览
📚 资料
```

### 主面板（中央）

**Phase 1-3**：讨论面板

```
结构 · 讨论中                           🐢 ──●── 🐇

🏗 鲁班:
- 八阳四阴双线结构，阳写人，阴写制度
- 中段靠阳三-阳四关系建立撑
- 风险：阳三到阳五没有外部事件推动

📝 铁面:
- 同意双线结构
- 阳三只推进氛围一个维度，需要加关系推进
- 但是：不需要外部事件，内部关系变化就够

📖 知音 ▊                              typing
- 同意铁面，关系变化比外部事件更符合这篇气质▊

──────────────────────────────────
🟢 共识
✓ 八阳四阴双线结构
✓ 阳三改为关系建立场景
⚡ 分歧: 是否需要外部事件

[确认纪要 → 执行修改]
```

**Phase 4**：Scriptment + 讨论（左右分栏）

```
┌──────────────────┬─────────────────┐
│   Scriptment     │    讨论面板      │
│   （可编辑）      │                 │
│                  │  📝 铁面:       │
│                  │  - 阳三场景功能  │
│                  │    不足          │
│                  │                 │
│                  │  📖 知音:       │
│                  │  - 同意。阳三是  │
│                  │    第一次想跳过  │
│                  │                 │
│                  │  🏗 鲁班:       │
│                  │  - 把何伊场景改  │
│                  │    为"被使唤"    │
│                  │                 │
│──────────────────│  🟢 共识        │
│ [重新讨论]        │  ✓ 阳三加关系   │
│ [确认 → 扩写]    │    推进功能      │
└──────────────────┴─────────────────┘
```

**Phase 5**：章节列表 + 编辑器 + 讨论（三栏）

```
┌──────────┬──────────────────┬─────────────┐
│ 章节列表  │   章节正文        │   讨论面板   │
│          │  （可编辑）       │             │
│ ● 阳一✓  │                  │  Pre-Brief: │
│ ● 阳二✓  │                  │  🎭: 何伊   │
│ ◐ 阳三←  │                  │    ≤15字    │
│ ○ 阴一   │                  │  🏗: 功能=  │
│ ○ 阳四   │                  │    关系建立  │
│          │                  │             │
│ ─────    │                  │  Post-Rev:  │
│ Bone:    │                  │  📝: ✓骨架  │
│ scriptment│                 │  🎭: ⚠声音  │
│ 对应段落  │                  │    漂移     │
│          ├──────────────────┤             │
│          │ [修改] [通过→]    │ [→下一章]   │
└──────────┴──────────────────┴─────────────┘
```

### 输入区（底部）

```
🖊 [我有话说...]                    ⏸暂停  [发送]
🐢 ──●────── 🐇
realtime  fast  instant
```

- "我有话说"：点击暂停讨论，输入意见，发送后讨论恢复
- 速度滑块：控制渲染速度（realtime / fast / instant）
- 暂停：暂停渲染，后端继续生成

---

## 技术架构

```
masterminds/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 项目列表
│   │   ├── project/[slug]/
│   │   │   ├── page.tsx                # 主界面（进度条 + 主面板 + 输入区）
│   │   │   ├── ScriptmentEditor.tsx    # Phase 4 组件
│   │   │   └── ChapterExpander.tsx     # Phase 5 组件
│   │   └── api/
│   │       ├── projects/               # 项目 CRUD
│   │       ├── roundtable/             # 讨论 SSE endpoint
│   │       │   ├── route.ts            # 发起讨论
│   │       │   └── interject/route.ts  # 用户插话
│   │       ├── scriptment/             # Scriptment 生成
│   │       ├── expand/                 # 章节扩写 + briefing
│   │       ├── chronicler/             # 史官归纳
│   │       └── phases/                 # Phase 状态管理
│   ├── lib/
│   │   ├── agents/
│   │   │   ├── roundtable.ts           # 讨论引擎核心
│   │   │   ├── chronicler.ts           # 史官归纳逻辑
│   │   │   ├── context.ts              # 上下文组装
│   │   │   └── roles.ts                # 角色定义加载
│   │   ├── project.ts                  # 项目状态
│   │   └── llm.ts                      # LLM 调用层
│   └── components/
│       └── DiscussionPanel.tsx          # 讨论面板（速度控制 + 渲染）
│
├── agents/                              # 角色定义 + 技能
│   ├── roles/
│   ├── skills/
│   ├── frameworks/
│   └── checklists/
│
├── data/                                # 项目数据
│   └── {project-slug}/
│
└── PLAN.md
```

### 技术选型

- **前端**：Next.js + Tailwind（已有）
- **数据库**：SQLite + Prisma（项目元数据、讨论记录）
- **内容存储**：文件系统 markdown/json（稿件、bible、纪要）
- **LLM**：多模型支持（Claude、GPT、DeepSeek、Gemini），按角色路由
- **讨论引擎**：SSE streaming，后端全速生成，前端缓冲渲染

### 删除的旧组件

| 旧组件 | 状态 |
|--------|------|
| Beat 系统（/api/beats, beat-summary） | 删除。章节是最小写作单位 |
| DraftWorkspace.tsx | 删除。替换为 ScriptmentEditor + ChapterExpander |
| Clips 系统 | 删除 |
| 独立的 Review Phase | 删除。审稿集成在 Scriptment 和 Expansion 中 |
| 4-agent 并行独立 review | 删除。改为有序讨论 |
| Anti-shrink 90% 硬规则 | 改为可选（结构修改允许大幅删减） |

---

## 详细技术规格

### Roundtable Engine（`src/lib/agents/roundtable.ts`）

讨论引擎是整个系统的核心 primitive。所有 agent 协作都通过它。

#### 数据结构

```typescript
interface Discussion {
  id: string;                      // "disc_20260502_structure_01"
  projectSlug: string;
  agenda: AgendaType;              // "conception" | "bible" | "structure" | ...
  topic: string;                   // 用户可读的议题描述
  material: string;                // 被讨论的素材（scriptment、beat sheet 等）
  participants: string[];          // 有序的 agent 列表
  rounds: DiscussionRound[];
  status: "discussing" | "awaiting_human" | "summarizing" | "resolved";
  chroniclerSummary?: string;      // 史官纪要（讨论结束后填入）
  createdAt: string;
  resolvedAt?: string;
}

interface DiscussionRound {
  round: number;
  messages: DiscussionMessage[];
}

interface DiscussionMessage {
  role: string;                    // agent 代号或 "human"
  label: string;                   // 显示名（"鲁班"、"铁面"、"你"）
  icon: string;                    // emoji icon
  content: string;                 // 发言内容（要点格式）
  timestamp: string;
  seenBy: string[];                // 该 agent 发言时已看到哪些前人的发言
}

type AgendaType = 
  | "conception" 
  | "bible" 
  | "structure" 
  | "structural_review" 
  | "pre_briefing" 
  | "chapter_review"
  | "free";                        // 用户自由发起的讨论

interface Agenda {
  participants: string[];          // 有序
  maxRounds: number;
  focusPrompts: Record<string, string>;  // 每个 agent 的发言角度
  advanceCondition: string;        // 什么条件下可以推进
  outputs: string[];               // 讨论应该产出什么
}
```

#### 引擎核心逻辑

```typescript
async function runRoundtable(
  discussion: Discussion,
  send: (event: SSEEvent) => void,
  getInterject: () => Promise<string | null>,  // 轮询用户是否要插话
): Promise<Discussion> {
  
  const agenda = AGENDAS[discussion.agenda];
  
  for (let round = 1; round <= agenda.maxRounds; round++) {
    send({ type: "round_start", round });
    
    const roundMessages: DiscussionMessage[] = [];
    
    // 收集本轮之前所有发言（含上一轮）
    const priorMessages = discussion.rounds.flatMap(r => r.messages);
    
    for (const participant of agenda.participants) {
      // 构建该 agent 能看到的上下文
      const visible = [...priorMessages, ...roundMessages];
      const seenBy = visible.map(m => m.role);
      
      // 构建 prompt
      const system = buildDiscussionSystem(participant, discussion, agenda);
      const userPrompt = buildDiscussionPrompt(
        participant, 
        discussion.material, 
        visible,           // 前人发言
        agenda.focusPrompts[participant],  // 发言角度
        round,
      );
      
      send({ type: "turn_start", agent: participant, label: LABELS[participant], icon: ICONS[participant] });
      
      // Stream agent response
      let fullText = "";
      await stream(
        routeProvider(participant),
        [{ role: "user", content: userPrompt }],
        { system, maxTokens: 1000 },  // 硬性限制 token 数，防止长篇大论
        {
          onText: (text) => {
            fullText += text;
            send({ type: "chunk", agent: participant, text });
          },
          onDone: () => {
            send({ type: "turn_done", agent: participant });
          },
        }
      );
      
      roundMessages.push({
        role: participant,
        label: LABELS[participant],
        icon: ICONS[participant],
        content: fullText,
        timestamp: new Date().toISOString(),
        seenBy,
      });
      
      // 每个 agent 说完后，检查用户是否要插话
      const interject = await getInterject();
      if (interject) {
        roundMessages.push({
          role: "human",
          label: "你",
          icon: "👤",
          content: interject,
          timestamp: new Date().toISOString(),
          seenBy: roundMessages.map(m => m.role),
        });
        send({ type: "human_interject", text: interject });
      }
    }
    
    discussion.rounds.push({ round, messages: roundMessages });
    send({ type: "round_done", round });
    
    // 检测是否需要下一轮（有分歧？）
    if (round < agenda.maxRounds) {
      const hasDisagreement = await detectDisagreement(roundMessages);
      if (!hasDisagreement) break;  // 一致就提前结束
      send({ type: "disagreement_detected", details: "进入第二轮讨论" });
    }
  }
  
  // 史官归纳
  send({ type: "summarizing" });
  discussion.chroniclerSummary = await runChronicler(discussion);
  discussion.status = "resolved";
  send({ type: "summary_ready", summary: discussion.chroniclerSummary });
  
  // 持久化
  saveDiscussion(discussion);
  
  return discussion;
}
```

#### 讨论 Prompt 构建

每个 agent 发言时收到的 system prompt：

```typescript
function buildDiscussionSystem(role: string, discussion: Discussion, agenda: Agenda): string {
  const parts: string[] = [];
  
  // 1. 角色身份
  parts.push(loadRole(role).systemPrompt);
  
  // 2. 讨论规则（所有人共用）
  parts.push(DISCUSSION_RULES);  // 即上面的"你在开会，不是写报告"
  
  // 3. 该 agent 在本次讨论中的角度
  parts.push(`## 你在本次讨论中的角度\n${agenda.focusPrompts[role]}`);
  
  // 4. 前序阶段的纪要（硬约束）
  const summaries = loadPhaseSummaries(discussion.projectSlug);
  if (summaries) parts.push(summaries);
  
  // 5. agent notes（如有）
  const notes = loadAgentNotes(discussion.projectSlug, role);
  if (notes) parts.push(notes);
  
  return parts.join("\n\n---\n\n");
}

function buildDiscussionPrompt(
  role: string,
  material: string,
  priorMessages: DiscussionMessage[],
  focusAngle: string,
  round: number,
): string {
  const parts: string[] = [];
  
  // 素材
  parts.push(`## 讨论素材\n\n${material}`);
  
  // 前人发言
  if (priorMessages.length > 0) {
    const transcript = priorMessages
      .map(m => `${m.icon} ${m.label}:\n${m.content}`)
      .join("\n\n");
    parts.push(`## 前面的发言\n\n${transcript}`);
  }
  
  // 指令
  if (round === 1) {
    parts.push(`请围绕你的角度发言。回应前面的人再说你自己的观点。≤3个要点。`);
  } else {
    parts.push(`这是第${round}轮。请回应上一轮的分歧，尝试收敛。≤3个要点。`);
  }
  
  return parts.join("\n\n---\n\n");
}
```

#### 分歧检测

轻量模型扫描一轮发言，判断是否有分歧：

```typescript
async function detectDisagreement(messages: DiscussionMessage[]): Promise<boolean> {
  const transcript = messages.map(m => `${m.label}: ${m.content}`).join("\n\n");
  
  const result = await complete("gemini", [
    { role: "user", content: `以下是一段编剧室讨论。请判断是否存在实质性分歧（不是措辞不同，是观点对立）。只回答 YES 或 NO。\n\n${transcript}` }
  ], { model: MODEL_UTILITY.gemini, maxTokens: 10 });
  
  return result.trim().toUpperCase().includes("YES");
}
```

### 史官引擎（`src/lib/agents/chronicler.ts`）

```typescript
const CHRONICLER_SYSTEM = `你是史官。你不参与讨论，只负责归纳。

输出格式（严格遵守，不要加任何其他内容）：

## 共识
- （每条一句话，只写所有人同意的决策）

## 分歧
- （如果所有分歧已由创作者裁决，写"无"）
- 议题：xxx
  - 甲方（谁）：一句话
  - 乙方（谁）：一句话
  - 创作者裁决：xxx（如果创作者已表态）/ 待裁决

## 待办
- （下一步需要执行的具体动作，每条一句话，指明由谁执行）

## 约束
- （本次讨论新确立的不可违反的规则，如果没有就写"无"）

规则：
1. 不加评论、不加过渡句、不总结"大家认为"
2. 只列事实
3. 如果某条共识是创作者裁决的结果，标注"（创作者裁决）"
4. 待办必须可执行，不要写"继续讨论"这种`;

async function runChronicler(discussion: Discussion): Promise<string> {
  // 构建完整讨论记录
  const transcript = discussion.rounds
    .flatMap(r => r.messages)
    .map(m => `${m.icon} ${m.label}:\n${m.content}`)
    .join("\n\n---\n\n");
  
  const result = await complete("gemini", [
    { role: "user", content: `请归纳以下编剧室讨论：\n\n${transcript}` }
  ], { 
    system: CHRONICLER_SYSTEM,
    model: MODEL_UTILITY.gemini,  // 用轻量模型，归纳不需要大模型
    maxTokens: 2000,
  });
  
  // 持久化纪要
  const summaryPath = join(DATA_DIR, discussion.projectSlug, "summaries", `${discussion.id}.md`);
  writeFileSync(summaryPath, result, "utf-8");
  
  return result;
}
```

### SSE API Endpoint（`src/app/api/roundtable/route.ts`）

```typescript
// POST /api/roundtable — 发起讨论
// Request body:
{
  projectSlug: string;
  agenda: AgendaType;           // "conception" | "bible" | "structure" | ...
  topic: string;                // "节拍表是否支撑中段"
  material?: string;            // 被讨论的素材（可选，有的议程会自动加载）
}

// SSE response events:
{ type: "discussion_start", id: string, agenda: string, participants: string[] }
{ type: "round_start", round: number }
{ type: "turn_start", agent: string, label: string, icon: string }
{ type: "chunk", agent: string, text: string }
{ type: "turn_done", agent: string }
{ type: "human_interject", text: string }
{ type: "round_done", round: number }
{ type: "disagreement_detected", details: string }
{ type: "summarizing" }
{ type: "summary_ready", summary: string }
{ type: "discussion_done", id: string }
{ type: "error", message: string }
```

```typescript
// POST /api/roundtable/interject — 用户插话
// Request body:
{
  discussionId: string;
  message: string;
}

// Response:
{ ok: true }
```

插话实现：服务器维护一个 per-discussion 的 interject queue（内存中的 Map<string, string[]>）。roundtable engine 的 `getInterject()` 从这个 queue 中 pop。

```typescript
// 内存中的插话队列
const interjectQueues = new Map<string, string[]>();

// roundtable engine 调用的回调
async function getInterject(discussionId: string): Promise<string | null> {
  const queue = interjectQueues.get(discussionId);
  if (queue && queue.length > 0) {
    return queue.shift()!;
  }
  // 等待一小段时间让用户有机会插话
  await sleep(500);  // 500ms 窗口
  const q2 = interjectQueues.get(discussionId);
  if (q2 && q2.length > 0) {
    return q2.shift()!;
  }
  return null;
}
```

### 前端讨论面板（`src/components/DiscussionPanel.tsx`）

#### 速度控制渲染

```typescript
interface SpeedConfig {
  charDelay: number;     // ms per character
  turnPause: number;     // ms between agent turns
}

const SPEEDS: Record<string, SpeedConfig> = {
  realtime: { charDelay: 30, turnPause: 2000 },
  fast:     { charDelay: 10, turnPause: 500 },
  instant:  { charDelay: 0,  turnPause: 0 },
};

// 渲染引擎
function useBufferedRenderer(speed: string) {
  const buffer = useRef<SSEEvent[]>([]);
  const [rendered, setRendered] = useState<RenderedMessage[]>([]);
  const [currentTyping, setCurrentTyping] = useState<{ agent: string; text: string } | null>(null);
  const paused = useRef(false);
  
  // SSE onmessage → push to buffer
  function pushEvent(event: SSEEvent) {
    buffer.current.push(event);
  }
  
  // Render loop
  useEffect(() => {
    const config = SPEEDS[speed];
    let animFrame: number;
    let charIndex = 0;
    let currentText = "";
    
    async function renderLoop() {
      if (paused.current || buffer.current.length === 0) {
        animFrame = requestAnimationFrame(renderLoop);
        return;
      }
      
      const event = buffer.current[0];
      
      switch (event.type) {
        case "turn_start":
          setCurrentTyping({ agent: event.agent, text: "" });
          buffer.current.shift();
          if (config.turnPause > 0) await sleep(config.turnPause);
          break;
          
        case "chunk":
          if (config.charDelay === 0) {
            // instant: 直接追加
            currentText += event.text;
            setCurrentTyping(prev => prev ? { ...prev, text: currentText } : null);
            buffer.current.shift();
          } else {
            // 逐字渲染
            if (charIndex < event.text.length) {
              currentText += event.text[charIndex];
              setCurrentTyping(prev => prev ? { ...prev, text: currentText } : null);
              charIndex++;
              await sleep(config.charDelay);
            } else {
              charIndex = 0;
              buffer.current.shift();
            }
          }
          break;
          
        case "turn_done":
          // 把 currentTyping 移入 rendered
          if (currentTyping) {
            setRendered(prev => [...prev, {
              role: currentTyping.agent,
              content: currentText,
              // ... label, icon, timestamp
            }]);
          }
          setCurrentTyping(null);
          currentText = "";
          buffer.current.shift();
          break;
          
        case "summary_ready":
          setRendered(prev => [...prev, {
            role: "chronicler",
            content: event.summary,
            isSummary: true,
          }]);
          buffer.current.shift();
          break;
          
        // ... 其他 event type
      }
      
      animFrame = requestAnimationFrame(renderLoop);
    }
    
    renderLoop();
    return () => cancelAnimationFrame(animFrame);
  }, [speed]);
  
  return { rendered, currentTyping, pushEvent, pause: () => paused.current = true, resume: () => paused.current = false };
}
```

#### 插话 UI

```typescript
function InterjectBar({ discussionId, onInterject }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  
  async function submit() {
    if (!text.trim()) return;
    await fetch("/api/roundtable/interject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discussionId, message: text }),
    });
    onInterject(text);
    setText("");
    setOpen(false);
  }
  
  if (!open) {
    return <button onClick={() => setOpen(true)}>🖊 我有话说</button>;
  }
  
  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="你的意见..." />
      <button onClick={submit}>发送</button>
      <button onClick={() => setOpen(false)}>取消</button>
    </div>
  );
}
```

### Scriptment 生成（`src/app/api/scriptment/route.ts`）

```typescript
// POST /api/scriptment — 生成 scriptment
// Request body:
{
  projectSlug: string;
  provider?: ModelProvider;   // 默认 claude-code
}

// 内部逻辑：
// 1. 加载 beat sheet + bible + style guide + 所有纪要中的约束
// 2. 单模型单 pass 生成

const SCRIPTMENT_SYSTEM = `你是一个小说家。你要写一个完整故事的速写版。

速写不是大纲，不是摘要。它是一个压缩版的故事——可以读，有叙事节奏，但密度更高。

规则：
1. 包含每个场景的核心动作（不是"他去了那里"，而是实际写出关键动作）
2. 包含关键对话的实际台词（不是"他们讨论了X"，而是写出最重要的几句原话）
3. 包含重要意象（每个场景至少一个具体的感官细节）
4. 包含场景之间的转换（不要突然跳切）
5. 不包含详细的氛围铺垫、过渡段、次要对话
6. 每个场景用 ### 标题分隔，标题是场景名（如"### 阳一：抵达"）
7. 目标字数：约 {targetWords} 字

重要：你在写一个连贯的故事，只是比最终版更紧凑。读者应该能只读速写就理解完整的故事。`;

// Scriptment prompt 中注入的上下文：
// - beat sheet 全文
// - bible（角色档案 + 世界设定）
// - style guide
// - 所有前序 phase 纪要中的 ## 约束 部分
```

### 章节扩写（`src/app/api/expand/route.ts`）

```typescript
// POST /api/expand — 扩写一章
// Request body:
{
  projectSlug: string;
  chapterName: string;         // "阳三"
  briefing: string;            // pre-briefing 讨论纪要
  provider?: ModelProvider;
}

// 内部逻辑：
// 1. 加载 scriptment 全文
// 2. 找到 scriptment 中本章对应段落（通过 ### 标题匹配）
// 3. 加载已完成的前 2 章全文 + 更早章摘要
// 4. 加载 bible 中本章相关角色
// 5. 组装 prompt

const EXPANSION_SYSTEM = `你是一个小说家。你要把一段故事速写扩写为完整的散文章节。

规则：
1. 速写是骨架。扩写时保持骨架的事件顺序和关键对话不变
2. 添加：氛围描写、感官细节、人物内心活动、过渡段、次要对话
3. 不添加：速写中没有的新事件、新角色、新信息
4. 如果你觉得速写中缺了什么，在文末用 [NOTE: ...] 标注，不要自行添加
5. 注意和前一章的衔接——语感、节奏、情绪的延续
6. 直接输出正文，不要加标题、自检报告、字数统计

扩写的上下文：
- 你能看到速写全文（了解后面会发生什么，避免提前泄露）
- 你能看到前 2 章的完整文本（衔接语感）
- 你能看到角色声音 DNA（保持一致）
- 你能看到 briefing（本章的结构功能和注意事项）`;

function buildExpansionPrompt(
  scriptment: string,           // 全文
  chapterSection: string,       // scriptment 中本章对应段落
  prevChapters: string[],       // 前 2 章全文
  earlierSummaries: string[],   // 更早章摘要
  characterBriefs: string[],    // 本章出场角色的 voice DNA
  briefing: string,             // pre-briefing 纪要
  styleGuide: string,
): string {
  const parts: string[] = [];
  
  parts.push(`## 速写全文（供参考，了解全局走向）\n\n${scriptment}`);
  parts.push(`## 本章速写（你要扩写的部分）\n\n${chapterSection}`);
  
  if (prevChapters.length > 0) {
    parts.push(`## 前序章节（衔接语感）\n\n${prevChapters.join("\n\n---\n\n")}`);
  }
  if (earlierSummaries.length > 0) {
    parts.push(`## 更早章节摘要\n\n${earlierSummaries.join("\n\n")}`);
  }
  if (characterBriefs.length > 0) {
    parts.push(`## 本章出场角色\n\n${characterBriefs.join("\n\n---\n\n")}`);
  }
  parts.push(`## Pre-Briefing 纪要\n\n${briefing}`);
  if (styleGuide) parts.push(`## 风格指南\n\n${styleGuide}`);
  
  parts.push(`请扩写本章。直接输出正文。`);
  
  return parts.join("\n\n---\n\n");
}
```

### Phase 状态机

```typescript
type Phase = "conception" | "bible" | "structure" | "scriptment" | "expansion";

interface PhaseState {
  phase: Phase;
  status: "discussing" | "writing" | "reviewing" | "confirmed";
  discussions: string[];         // 本 phase 的讨论 ID 列表
  artifacts: string[];           // 本 phase 产出的文件路径
  confirmedAt?: string;
}

// Phase 推进条件
const ADVANCE_CONDITIONS: Record<Phase, (slug: string) => boolean> = {
  conception: (slug) => {
    // 至少一个讨论已 resolved，纪要中有 logline
    const summaries = loadPhaseSummaries(slug, "conception");
    return summaries.includes("logline") || summaries.includes("核心冲突");
  },
  bible: (slug) => {
    // 角色档案文件存在
    const charDir = join(DATA_DIR, slug, "bible", "characters");
    return existsSync(charDir) && readdirSync(charDir).filter(f => f.endsWith(".md")).length > 0;
  },
  structure: (slug) => {
    // beat sheet 存在
    return existsSync(join(DATA_DIR, slug, "structure", "beats.md"));
  },
  scriptment: (slug) => {
    // approved scriptment 存在
    return existsSync(join(DATA_DIR, slug, "scriptment", "approved.md"));
  },
  expansion: (slug) => {
    // 所有章节写完（对照 beat sheet 中的章节数）
    return true; // 实际检查逻辑
  },
};
```

### LLM 路由策略

讨论和写作使用不同的模型路由：

```typescript
// 讨论发言：不需要最强模型，需要快和便宜
const DISCUSSION_PROVIDERS: Record<string, ModelProvider> = {
  idea: "deepseek",        // 发散思维
  architect: "deepseek",   // 推理结构
  character: "gpt",        // 角色感知
  editor: "claude-code",   // 精准分析
  reader: "gemini",        // 快速判断
  continuity: "gemini",    // 长上下文
};

// 写作任务：需要最强的创意模型
const WRITING_PROVIDERS: Record<string, ModelProvider> = {
  scriptment: "claude-code",   // 全文连贯性需要最强模型
  expansion: "gpt",            // 语感密度
  revision: "claude-code",     // 精确修改
  beat_sheet: "deepseek",      // 结构推理
  character_profile: "gpt",    // 角色塑造
};

// 史官归纳：轻量模型即可
const CHRONICLER_PROVIDER: ModelProvider = "gemini";
```

### 错误处理

```typescript
// Agent 发言失败
// → 跳过该 agent，继续下一个
// → 在 SSE 中发出 { type: "agent_error", agent, error }
// → 讨论仍然有效，只是少一个人的意见

// 史官归纳失败
// → 重试一次（换模型）
// → 仍失败则把原始讨论记录展示给用户，让用户手动总结

// 用户插话超时（长时间不回应）
// → 讨论继续，不等待

// Scriptment 生成超时
// → 分段生成：先写前半部分，再续写后半部分

// 扩写生成质量过低（字数不足目标的 50%）
// → 标记为 draft_failed，让用户选择重新生成或手动编辑
```

### 数据迁移（理埠项目）

理埠是唯一一个走过完整旧流程的项目。迁移策略：

```
现有数据                          迁移到
─────────                         ──────
data/理埠/draft/*.md              → data/理埠/draft/*.md（保留，这就是 expansion 的产出）
data/理埠/reviews/round_1.json    → data/理埠/discussions/legacy_review.json
data/理埠/phases/*.md             → data/理埠/phases/*.md（保留）
data/理埠/bible/*                 → data/理埠/bible/*（保留）

需要补充：
- data/理埠/scriptment/           → 从现有 draft 反向压缩生成（或手写）
- data/理埠/summaries/            → 从 review round_1.json 中提取共识
```

不需要为理埠重新走一遍流程。它已经有完整的产出，可以从 Phase 5（expansion）的修改阶段继续。

---

## iOS 客户端

### 定位

手机上的 showrunner 遥控器。看讨论、插话、确认纪要、拍板推进。不做重度编辑。

讨论可以慢一点——手机上默认 realtime 速度，看 agents 像发微信一样一条条发言。

### 架构：复用 MiraApp 模式

和 MiraApp 完全相同的架构：MiraBridge 双通道 + SyncEngine + CommandWriter。

```
MasterMindsApp (iPhone)
    ↓
MasterMindsBridge (Swift Package)
    ├── API 通道（同 WiFi）: 直连 Mac 上的 Next.js 服务器
    │   ├── SSE: 实时看讨论 ← /api/roundtable SSE stream
    │   ├── POST: 插话 ← /api/roundtable/interject
    │   ├── POST: 确认纪要 / 推进 phase ← /api/phases
    │   └── GET: 读取项目状态、章节内容 ← /api/projects, /api/scriptment, etc.
    │
    └── iCloud 通道（离开家）: 异步读写
        ├── 读: discussions/*.json, summaries/*.md, phases/*.md
        ├── 写: commands/interject_*.json, commands/confirm_*.json
        └── Mac 上的 Next.js 轮询 commands/ 目录处理命令
```

**双通道切换**：和 MiraApp 一样，SyncEngine 先尝试 API（Bonjour 发现或保存的 URL），失败就 fallback 到 iCloud 文件。用户无感知。

### iCloud Bridge 路径

```
~/Library/Mobile Documents/com~apple~CloudDocs/MtJoy/
├── Mira-Bridge/          ← MiraApp 已有
└── MasterMinds-Bridge/   ← 新增
    ├── heartbeat.json    ← Mac 端 Next.js 写，iPhone 读
    ├── projects.json     ← 项目列表快照
    ├── {project-slug}/
    │   ├── state.json    ← 当前 phase、活跃讨论状态
    │   ├── discussions/
    │   │   └── {id}.json ← 讨论记录（agents 发言完毕后同步）
    │   ├── summaries/
    │   │   └── {id}.md   ← 史官纪要
    │   ├── scriptment.md ← 当前 scriptment（只读浏览）
    │   └── draft/
    │       └── *.md      ← 已完成章节（只读浏览）
    └── commands/         ← iPhone → Mac 命令
        ├── interject_{ts}.json   ← 插话
        ├── confirm_{ts}.json     ← 确认纪要 / 推进 phase
        └── start_discussion_{ts}.json  ← 发起新讨论
```

**Mac 端处理命令**：Next.js 服务器每 5 秒扫描 `commands/` 目录，处理后删除文件。和 Mira 的 CommandWriter 模式完全一致。

### Swift Package: MasterMindsBridge

```
MasterMindsBridge/swift/
├── Package.swift
└── Sources/MasterMindsBridge/
    ├── Models/
    │   ├── Project.swift           # 项目模型
    │   ├── Discussion.swift        # 讨论 + 消息模型
    │   ├── Summary.swift           # 史官纪要模型
    │   └── Phase.swift             # Phase 状态
    └── Services/
        ├── BridgeConfig.swift      # iCloud 路径 + API URL + Bonjour 发现
        ├── SyncEngine.swift        # 双通道同步（复用 MiraBridge 的逻辑）
        ├── CommandWriter.swift     # 写命令到 iCloud
        ├── ProjectStore.swift      # 项目列表 + 状态
        ├── DiscussionStore.swift   # 讨论记录 + 实时更新
        └── SSEClient.swift         # SSE 流式客户端（看讨论用）
```

**SSEClient**：当 API 通道可用时，直接消费 `/api/roundtable` 的 SSE stream。比轮询 iCloud 文件快很多。

```swift
@Observable
final class SSEClient {
    var messages: [DiscussionMessage] = []
    var currentTyping: (agent: String, text: String)?
    var status: DiscussionStatus = .idle
    
    private var task: URLSessionDataTask?
    
    func connect(to url: URL) {
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        
        task = URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            // Parse SSE events, update messages/currentTyping/status
        }
        task?.resume()
    }
    
    func interject(_ text: String, discussionId: String, baseURL: URL) async {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/roundtable/interject"))
        request.httpMethod = "POST"
        request.httpBody = try? JSONEncoder().encode(["discussionId": discussionId, "message": text])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try? await URLSession.shared.data(for: request)
    }
}
```

### SwiftUI App 结构

```
MasterMindsApp/
├── MasterMindsApp.swift        # @main, 和 MiraApp 相同模式
├── Views/
│   ├── HomeView.swift          # 项目列表
│   ├── ProjectView.swift       # 项目主页（phase 进度 + 当前状态）
│   ├── DiscussionView.swift    # 讨论面板（核心 view）
│   ├── SummaryView.swift       # 纪要查看 + 确认
│   ├── ScriptmentView.swift    # Scriptment 只读浏览
│   ├── ChapterView.swift       # 章节只读浏览
│   └── SettingsView.swift      # 连接设置
└── Services/
    └── (由 MasterMindsBridge package 提供)
```

### 核心 View: DiscussionView

手机上讨论面板是全屏的，像聊天界面：

```
┌──────────────────────────┐
│ ← 理埠    结构讨论    ··· │
├──────────────────────────┤
│                          │
│  🏗 鲁班              now│
│  ┌────────────────────┐  │
│  │- 八阳四阴双线结构   │  │
│  │- 中段靠关系建立撑   │  │
│  │- 风险：无外部事件    │  │
│  └────────────────────┘  │
│                          │
│  📝 铁面              now│
│  ┌────────────────────┐  │
│  │- 同意双线结构       │  │
│  │- 阳三需加关系推进   │  │
│  │- 但是：不需外部事件  │  │
│  └────────────────────┘  │
│                          │
│  📖 知音 ▊          typing│
│  ┌────────────────────┐  │
│  │- 同意铁面▊          │  │
│  └────────────────────┘  │
│                          │
├──────────────────────────┤
│  🟢 3条共识  ⚡ 1条分歧   │  ← 讨论收敛后出现
│  [查看纪要]  [确认 →]     │
├──────────────────────────┤
│ 🖊 我有话说...    [发送]  │
└──────────────────────────┘
```

**关键交互**：
- 讨论自动滚动，agents 的发言像微信消息一样一条条出现
- 底部输入框随时可以打字插话
- 讨论结束后底部出现"查看纪要"和"确认"按钮
- 速度默认 realtime（手机上慢一点更自然）
- 下拉可以看历史讨论

### 核心 View: ProjectView

项目主页，像一个 timeline：

```
┌──────────────────────────┐
│ ← 项目    理埠            │
├──────────────────────────┤
│                          │
│  ● 构思 ✓                │
│    纪要：核心冲突是...    │
│                          │
│  ● 角色 ✓                │
│    5个角色已锁定          │
│                          │
│  ◐ 结构 ← 当前           │
│    ┌────────────────┐    │
│    │ 活跃讨论:       │    │
│    │ "节拍表中段加固" │    │
│    │ 3人讨论中       │    │
│    │ [进入讨论 →]    │    │
│    └────────────────┘    │
│                          │
│  ○ 速写                  │
│  ○ 扩写                  │
│                          │
├──────────────────────────┤
│  [发起新讨论]             │
│  [查看资料库]             │
└──────────────────────────┘
```

### 手机上能做什么 / 不能做什么

| 操作 | 手机 | 桌面 |
|------|------|------|
| 看讨论（实时 SSE） | ✓ | ✓ |
| 插话 | ✓ | ✓ |
| 确认纪要 | ✓ | ✓ |
| 推进 phase | ✓ | ✓ |
| 发起新讨论 | ✓ | ✓ |
| 浏览 scriptment | ✓（只读） | ✓（可编辑） |
| 浏览已完成章节 | ✓（只读） | ✓（可编辑） |
| 编辑 scriptment | ✗ | ✓ |
| 触发写作任务 | ✓（发命令） | ✓ |
| 管理 agent/模型设置 | ✗ | ✓ |

手机是遥控器，不是工作台。Showrunner 在沙发上看 agents 开会，觉得有想法就插一嘴，满意了按确认。

### 推送通知

和 MiraApp 一样通过本地通知：

```swift
// 什么时候推送
enum NotificationTrigger {
    case discussionNeedsInput    // 讨论出现分歧，等用户裁决
    case summaryReady            // 史官归纳完成，等用户确认
    case writingComplete         // scriptment 或章节写完，等用户审阅
    case phaseReady              // 可以推进到下一 phase
}
```

用户收到通知，点进去直接到对应的讨论/纪要页面。

### Mac 端需要的改动

Next.js 服务器需要新增：

1. **iCloud Bridge 写入**：讨论完成后把 discussion JSON 和纪要同步到 iCloud Bridge 目录
2. **Command 轮询**：每 5 秒扫描 `MasterMinds-Bridge/commands/`，处理插话/确认命令
3. **Bonjour 广播**：让 iPhone 能自动发现 Mac 上的 Next.js 服务器（或用户手动输入 IP）
4. **Heartbeat**：定期写 heartbeat.json 到 iCloud Bridge

这些和 Mira agent 已有的 bridge 逻辑几乎一样，可以复用大部分代码。

---

## 开发路线图

### Week 1: 讨论引擎 + Web UI

- [ ] `roundtable.ts` — 核心引擎
- [ ] `chronicler.ts` — 史官归纳
- [ ] `/api/roundtable` — SSE endpoint + interject
- [ ] `DiscussionPanel.tsx` — 讨论面板 + 速度控制
- [ ] 修改 `page.tsx` — 接入讨论面板，去掉旧 chat
- [ ] 用 Phase 1 (conception) 做端到端测试

### Week 2: Scriptment + 结构审稿

- [ ] `/api/scriptment` — 生成 + 加载
- [ ] `ScriptmentEditor.tsx` — 编辑器 + 讨论分栏
- [ ] 结构审稿三维度 prompts
- [ ] 结构审稿讨论议程

### Week 3: 章节扩写

- [ ] `/api/expand` — 扩写 + pre-briefing + post-review
- [ ] `ChapterExpander.tsx` — 三栏界面
- [ ] pre_briefing 和 chapter_review 议程
- [ ] 章节摘要自动生成

### Week 4: iOS 客户端

- [ ] MasterMindsBridge Swift package（复用 MiraBridge 模式）
- [ ] SSEClient — SSE 流式消费
- [ ] HomeView + ProjectView + DiscussionView
- [ ] SummaryView（纪要确认）
- [ ] iCloud Bridge 路径 + CommandWriter
- [ ] Mac 端 command 轮询 + iCloud 写入

### Week 5: 打磨 + 理埠迁移

- [ ] 数据迁移脚本
- [ ] 全流程端到端测试（Web + iOS）
- [ ] 推送通知
- [ ] 离线/异步模式测试（断开 WiFi 后通过 iCloud 操作）
- [ ] 导出功能（全文 markdown / epub）

---

## 设计原则

1. **讨论与写作分离**：讨论只出要点和决策（≤3 要点/人），写作单独执行。不在讨论中输出段落。
2. **史官归纳，不传原文**：agents 之间传递的是纪要，不是原始讨论。保持 context 精简。
3. **人类是 showrunner**：提出想法、在讨论中给建议、确认纪要、拍板推进。不需要做执行。
4. **有序发言**：每个 agent 看到前面所有人的发言再说话。这是合作，不是各自交报告。
5. **渐进式精度**：Conception → Bible → Structure → Scriptment → Expansion。不跳步。
6. **Scriptment 先行**：结构问题在 4000 字上修，不在 15000 字上修。
7. **全局上下文**：扩写每章时能看到 scriptment 全文 + 前序章节，杜绝信息重复。
8. **可控节奏**：讨论速度可调（realtime / fast / instant），可暂停，可插话。
9. **简短发言**：agent 每次 ≤3 要点。长内容（beat sheet、scriptment、章节散文）在讨论之外独立生成。
10. **纪要驱动**：phase 之间的信息传递靠史官纪要中的"共识"和"约束"，不靠原始讨论或完整产出物。
