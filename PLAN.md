# 神仙会 (Masterminds) — 长篇创作工程化平台

## 定位

独立产品。专做中长篇小说和剧本——这类项目周期长、结构复杂、需要多角色持续协作，不是聊聊天能写出来的。

Mira继续负责短文（essay、blog、短篇）。神仙会从Mira writer中继承重型写作基础设施（prompts、frameworks、skills、review循环），但架构完全独立。

## 核心理念

**编剧室模型 (Writers' Room)**

好莱坞编剧室的运作方式：一群专业人士围绕一个项目持续工作，各有分工，有争论有共识，最终由showrunner拍板。

- **你 = Showrunner**：提供idea，给方向，review，拍板
- **Agents = 编剧室成员**：各有专长，主动讨论，产出实际内容
- **App = 编剧室本身**：看板、讨论区、稿件、资料库、进度追踪

---

## Agent Teams

### 通用角色（小说和剧本共用）

| 角色 | 代号 | 职责 |
|------|------|------|
| **故事建筑师** | architect | 整体结构、节奏曲线、情节弧线设计 |
| **角色总监** | character | 角色心理、声音一致性、角色弧线、关系网络 |
| **场景写手** | writer | 实际写作——逐章逐场 |
| **主编** | editor | 多层级审稿：弧线、章节、段落、句子 |
| **连续性检查** | continuity | 事实追踪、时间线、角色状态、前后一致性 |
| **第一读者** | reader | 新鲜视角：哪里无聊、哪里困惑、哪里有感觉 |

### 小说特有

| 角色 | 代号 | 职责 |
|------|------|------|
| **世界构建师** | worldbuilder | 设定、规则、氛围、感官细节（尤其SF/奇幻） |

### 剧本特有

| 角色 | 代号 | 职责 |
|------|------|------|
| **视觉导演** | visual | 视觉叙事、动作描写、"show don't tell" |
| **台词医生** | dialogue | 对白打磨、潜台词、角色区分度 |
| **Coverage分析** | coverage | 行业标准coverage报告 |

### Agent实现

每个agent是一个**角色定义 + 专属prompt + 专属skills + 上下文窗口策略**。不是独立进程，而是按需调用的角色模板。核心区别在于：

1. **上下文构建不同**：writer需要当前章节+前后文+角色状态；editor需要全局视角+规格
2. **输出格式不同**：writer输出prose，editor输出结构化review，continuity输出fact diff
3. **调用时机不同**：有的每章调用，有的每个phase调用一次

---

## 工作流 (Workflow)

### 核心模式：多模型并行 + 择优

贯穿整个工作流的基本模式：**同一个任务，多个模型（Claude、GPT、DeepSeek）同时做，人类择优选用**。不是让一个agent从头写到尾，而是让多个模型竞争，保留最好的。Reviewer也是多模型并行review。

这借鉴了Claude Agent Teams的并行架构思路（shared task list、inter-agent messaging），但我们自己实现，因为需要：多模型支持、持久化memory、创作专用的讨论结构。

### 小说工作流：7个Phase

```
Phase 1: 构思 (Conception) — 交互式brainstorm
  ├── 人类提供种子idea（一个画面、一个问题、一个"如果…会怎样"）
  ├── Idea agent与人类反复brainstorm
  │   ├── 不是一次性生成，是对话——agent提问、挑战、拓展
  │   ├── "这个角色为什么要这么做？"
  │   ├── "如果反过来会怎样？"
  │   ├── "stakes够不够高？"
  ├── 逐步收敛：
  │   ├── 锁定主题 (theme)
  │   ├── 锁定规格 (type, length, POV, tense)
  │   ├── 锁定基调/风格 (tone, style direction)
  ├── 输出：logline、premise、主题陈述、风格方向
  └── 人类拍板 ✓

Phase 2: 世界与角色 (Bible)
  ├── 角色先于情节——角色的欲望和矛盾驱动plot
  │   ├── 每个角色：want (表层目标) vs need (深层需求)
  │   ├── 内在矛盾：want和need的冲突
  │   ├── 独特声音（对白样本）
  ├── worldbuilder生成世界设定（SF/奇幻项目）
  ├── 角色关系网络
  ├── 讨论轮：agents辩论角色可信度、关系张力
  └── 人类review、迭代、拍板 ✓

Phase 3: 结构 (Structure) — agent引导式共创
  ├── Architect提问引导人类敲定结构
  │   ├── "开头用什么hook？"
  │   ├── "中段靠什么撑？"（中段塌陷是长篇头号杀手）
  │   ├── "转折点在哪里？"
  │   ├── "结局是否earned？"
  ├── 生成节拍表 (beat sheet)
  ├── 章节大纲（每章：目标、冲突、转折、角色状态变化）
  │   ├── 每个场景必须有：目标、障碍、结果（成功/失败/意外）
  │   ├── 没有冲突的场景删掉
  ├── 副线索穿插、张力曲线
  ├── 中段特别加固：中点反转、subplot交叉、节奏变化
  ├── reader预审：结构层面的engagement预判
  └── 人类拍板 ✓

Phase 4: 写作 (Draft) — 多模型并行 + 择优
  ├── 逐章/逐段推进：
  │   ├── 多个模型（Claude/GPT/DeepSeek）同时写同一段
  │   ├── 人类从多个版本中择优选用（可以混搭）
  │   ├── continuity检查事实一致性
  │   ├── 多个reviewer同时review，汇总意见
  │   ├── 多轮修改，人类随时插入意见
  │   └── 人类拍板该段 ✓
  ├── 两种模式可选：
  │   ├── 谨慎模式：写一章review一章
  │   └── Flow模式：先写N章再集中review（初稿允许烂）
  ├── 每5章中期回顾（arc级，防中段塌陷）
  └── 写完全部章节

Phase 5: 审稿 (Review) — 多维度并行
  ├── 多个reviewer同时、多维度：
  │   ├── editor：全局弧线 + 行文
  │   ├── character：角色一致性 + 弧线完成度
  │   ├── reader：engagement + 节奏
  │   ├── continuity：事实 + 时间线
  ├── 汇总：优先级排序的issue列表
  └── 人类review issue列表、定修改方向 ✓

Phase 6: 修改 (Revision) — 迭代式，不是线性的
  ├── 修改是迭代的，不是按优先级线性走：
  │   ├── 改结构 → 可能打断角色弧线 → 改角色 → 节奏变了 → 改节奏
  │   ├── 每轮修改后re-review，发现新问题继续修
  ├── 多轮、每轮不同焦点：
  │   ├── 第1轮：结构（砍章、调序、补场景）
  │   ├── 第2轮：角色弧线（一致性、成长可信度）
  │   ├── 第3轮：节奏（哪里拖、哪里赶）
  │   ├── 第4轮+：行文逐句打磨
  ├── 同样多模型并行修改 + 择优
  └── 人类确认修改完成 ✓

Phase 7: 定稿 (Final)
  ├── 通读润色
  ├── 格式化（目标平台格式）
  └── 人类最终确认 ✓
```

### 人类随时介入

上面的Phase是大框架，但人类可以在**任何时刻**：
- 插入意见（"这里不对劲"）
- 发起讨论（"第七章转折太突兀吗？"）
- 改变方向（"角色动机改一下"）
- 回退（"这章重来"）

系统需要支持这种非线性介入，不能是僵硬的状态机。

### 剧本工作流：类似但有关键差异

- Phase 1加入：类型定位（电影/电视/短片）、目标时长
- Phase 2加入：场景设定（INT/EXT）、视觉风格方向
- Phase 3用序列结构（sequence）替代章节
- Phase 4写作单位是场景（scene），不是章节
- Phase 5加入coverage分析、对白专项审
- 格式严格遵循行业标准（Final Draft格式）

### Plotter vs Pantser

AI辅助创作天然偏plotter（大纲派），因为AI需要结构化指令。但系统应该支持灵活度：
- **严格plotter模式**：完全按大纲写，每章对照scene card
- **混合模式**：粗纲写作，允许章节内发现和偏离，偏离后更新大纲
- 不支持纯pantser（发现式写作），因为对AI来说这等于没有方向

---

## 讨论机制 (Discussion)

这是神仙会的核心特色——不是agent默默干活然后交作业，而是**可见的、有来有回的讨论**。

### 讨论类型

1. **Phase讨论**：每个phase开始时，相关agents围绕核心问题展开讨论
   - 例：Phase 1，architect提出三个可能的结构方案，reader评价各方案的读者体验，character指出角色潜力
   - 3-5轮，有结论

2. **Issue讨论**：针对具体问题的专题讨论
   - 例："第七章的转折是否太突兀？"
   - architect、writer、reader各给意见
   - 可由agent发起，也可由人类发起

3. **Review讨论**：审稿后的复盘
   - editor提出问题，writer回应，人类裁决

### 讨论实现

```
讨论 = {
  topic: string,
  phase: Phase,
  participants: Agent[],
  messages: Message[],      // agent发言 + 人类发言
  status: open | resolved,
  resolution: string | null, // 最终结论
  decision_by: human | consensus
}
```

每轮讨论：
1. 发起者陈述问题
2. 各参与者按序发言（每人看到前面所有发言）
3. 人类可随时插入意见
4. 讨论收敛后自动总结或人类拍板

---

## 项目知识库 (Project Knowledge Base)

长篇创作的核心挑战是**上下文管理**。60K-120K字的小说，任何LLM都无法一次性放入context。解法是结构化知识库。

```
project/
├── meta/
│   ├── project.json           # 状态、phase、配置
│   ├── logline.md
│   ├── premise.md
│   └── milestones.json        # 进度里程碑
│
├── bible/
│   ├── world.md               # 世界设定
│   ├── characters/
│   │   ├── {name}.md          # 角色档案
│   │   └── relationships.md   # 关系网络
│   ├── locations.md
│   ├── rules.md               # 世界规则（尤其SF/奇幻）
│   └── glossary.md
│
├── structure/
│   ├── beats.md               # 高层节拍表
│   ├── outline.md             # 章节大纲
│   ├── scenes/
│   │   └── ch{NN}.md          # 每章场景卡
│   ├── subplots.md            # 副线索
│   └── tension.json           # 张力曲线数据
│
├── draft/
│   ├── ch01.md
│   ├── ch02.md
│   └── ...
│
├── reviews/
│   ├── arc.md                 # 弧线审稿
│   ├── characters.md          # 角色一致性审稿
│   ├── chapters/
│   │   └── ch{NN}.json        # 每章review
│   └── issues.json            # 优先级issue列表
│
├── continuity/
│   ├── facts.json             # 已确立的事实
│   ├── character-states.json  # 每章角色状态快照
│   └── timeline.json          # 故事内时间线
│
├── discussions/
│   └── {id}.json              # 讨论记录
│
└── decisions.md               # 关键决策日志
```

### 上下文窗口策略

每次调用agent时，根据角色和任务动态组装context：

| 任务 | 必须包含 | 可选包含 |
|------|----------|----------|
| 写第N章 | 大纲ch(N)、bible摘要、前2章全文、角色状态(N-1)、决策日志 | 张力曲线、副线索 |
| 角色审稿 | 全部角色档案、每章角色状态、角色关系 | 对白摘录 |
| 弧线审稿 | 节拍表、每章摘要（不是全文）、张力曲线 | 前言/后记 |
| 连续性检查 | facts.json、timeline.json、当前章全文 | 前后章 |

**核心原则**：不把整本书塞进context，而是精确组装该任务需要的信息切片。

---

## 记忆系统 (Memory)

LLM是无状态的。一个长篇项目跨越几个月，每次agent调用都从零开始。Memory系统解决的问题是：**如何让agents在数百次调用之间保持连贯的理解**。

### 核心问题

知识库（bible、continuity）存的是**故事内的事实**。Memory存的是**创作过程中的认知**——人类的偏好、做过的决策、试过又放弃的方向、逐渐成型的风格感觉。这两者本质不同。

### Memory层级

#### 1. 项目记忆 (Project Memory)

项目级别的累积认知。整个编剧室共享。

```
memory/
├── project-memory.md      # 项目方向、关键转折、人类偏好
├── style-guide.md         # 逐渐成型的风格指南（不是预设的，是写作过程中沉淀的）
└── decisions.md           # 关键决策 + 理由 + 上下文
```

**project-memory.md** 不是流水账，是**对未来有用的认知**：
- "人类倾向短句，排斥过度修饰"
- "第三章讨论后放弃了浪漫副线，人类希望保持关系的模糊性"
- "人类对第五章节奏不满意，认为中段拖沓，要求加快"
- "SF设定中选择了硬科幻路线，不要魔法式的手波解释"

**style-guide.md** 随项目演进而生长：
- Phase 2时可能只有"偏向冷峻"
- Phase 4写了几章后变成："短句为主，动词优先，避免形容词堆砌，对话简洁但有潜台词，叙述视角保持心理距离2-3级"
- 不是人类手写的（虽然可以修改），是系统从人类的review意见和拍板倾向中自动提炼的

**decisions.md** 结构化记录：
```
### [2026-03-15] 放弃浪漫副线
- 触发：Phase 3结构讨论
- 参与者：architect, character, reader, 人类
- 决策：A和B的关系保持合作伙伴，不发展为恋爱
- 理由：人类认为恋爱线会稀释主题张力
- 影响范围：ch03, ch07, ch12大纲需要调整
```

#### 2. Agent笔记 (Agent Notes)

每个角色维护自己的工作笔记。这是该角色在这个项目中积累的**专业视角**。

```
memory/
├── agent-notes/
│   ├── architect.md       # "三幕结构中第二幕偏长，需要在ch10加入中点反转"
│   ├── character.md       # "角色A的声音倾向于反问句，角色B喜欢用比喻"
│   ├── writer.md          # "人类喜欢开头就进入动作，不要铺垫段"
│   ├── editor.md          # "反复出现的问题：过渡段太机械，需要更自然的场景切换"
│   ├── continuity.md      # "ch04中提到A有个妹妹，但角色档案中没有，需要补充或删除"
│   └── reader.md          # "ch06后半段engagement下降，可能是信息密度太高"
```

每个agent在完成任务后会被要求：**"基于这次工作，更新你的笔记——什么对以后有用？"**

这不是自动日志。是agent的主动反思，类似人类专业人士的工作笔记本。

#### 3. 章节摘要 (Chapter Summaries)

写完每章后自动生成的压缩表示。用于后续章节的context构建，不需要加载全文。

```
memory/
├── chapter-summaries/
│   ├── ch01.md            # 摘要：情节、角色状态变化、新引入元素、悬念
│   ├── ch02.md
│   └── ...
```

每个摘要包含：
- **情节摘要**（3-5句）
- **角色状态变化**（谁的什么变了）
- **新引入的事实**（新角色、新设定、新线索）
- **未解决的悬念**（reader需要记住的问题）
- **承诺**（对读者暗示了什么，后面需要兑现）

这比continuity的facts.json更高层——facts是原子事实，chapter summary是叙事级别的压缩。

#### 4. 讨论摘要 (Discussion Summaries)

长讨论压缩为可注入的摘要。

```
memory/
├── discussion-summaries/
│   └── {id}.md            # 核心分歧、各方观点、最终结论、对后续的影响
```

一个20条消息的讨论压缩成3-5句话，保留：
- 讨论了什么问题
- 有哪些关键分歧
- 最终怎么决定的（谁决定的）
- 对后续工作意味着什么

#### 5. 全局记忆 (Global Memory)

跨项目的记忆。人类的创作偏好、工作习惯、反复出现的审美倾向。

```
data/
├── global-memory.md       # 跨项目偏好
└── {project-slug}/
    └── memory/            # 项目级memory（上述1-4）
```

**global-memory.md** 例子：
- "偏好第三人称有限视角"
- "不喜欢过度explicit的主题陈述"
- "review时关注节奏多于关注用词"
- "对SF类型项目有更高的设定一致性要求"

新项目启动时自动注入global memory。随着项目增多，global memory越来越精确地反映人类的创作人格。

### Memory生命周期

```
捕获 → 压缩 → 注入 → 演进
```

1. **捕获 (Capture)**：在关键节点自动触发
   - 人类拍板后 → 更新decisions.md
   - 讨论结束后 → 生成discussion summary
   - 章节写完后 → 生成chapter summary
   - Agent完成任务后 → Agent更新自己的notes
   - 人类给review意见后 → 提取偏好，更新style-guide和project-memory

2. **压缩 (Compress)**：防止memory无限膨胀
   - Agent notes超过阈值时，要求agent自己精简（保留仍然有用的，删除过时的）
   - Project memory定期由architect角色做一次consolidation
   - 旧的章节摘要不删，但在context构建时按距离衰减（远的章节只注入摘要首句）

3. **注入 (Inject)**：context构建时按需拉取
   - 每次agent调用 = 角色定义 + 任务指令 + 知识库切片 + **相关memory切片**
   - 不是把所有memory都塞进去，而是根据任务类型选择：

   | 任务 | Memory注入 |
   |------|-----------|
   | 写第N章 | project-memory, writer notes, style-guide, ch(N-1)~ch(N-3) summaries, 相关decisions |
   | 角色审稿 | character notes, 全部chapter summaries的角色状态部分, 角色相关decisions |
   | 讨论 | project-memory, 参与者的agent notes, 相关discussion summaries |
   | 人类review后修改 | project-memory, style-guide, editor notes, 人类原始意见 |

4. **演进 (Evolve)**：memory不是只增不减
   - 决策被推翻 → decisions.md标记为superseded，不删除（保留思考过程）
   - 风格偏好变化 → style-guide更新，旧版本归档
   - Agent发现自己之前的笔记过时 → 主动修正
   - 项目结束后 → 从project memory中提炼有价值的部分并入global memory

### 和知识库的关系

```
知识库 (Knowledge Base)          记忆 (Memory)
─────────────────────           ──────────────
故事内的事实                      创作过程中的认知
bible: 世界是什么样的             project-memory: 我们为什么选择这样的世界
continuity: 角色做了什么          agent-notes: 角色写起来什么感觉
structure: 故事怎么安排           decisions: 为什么这样安排
draft: 写出来的文本              chapter-summaries: 写出来的东西意味着什么
                                style-guide: 怎样的文字是对的
```

两者互补。知识库是"what"，memory是"why + how + so what"。

---

## 技术架构

```
masterminds/
├── src/                        # Next.js前端 + API
│   ├── app/
│   │   ├── page.tsx            # 项目列表/仪表板
│   │   ├── project/[slug]/
│   │   │   ├── page.tsx        # 项目概览
│   │   │   ├── bible/          # 世界观&角色浏览
│   │   │   ├── structure/      # 大纲&结构视图
│   │   │   ├── draft/          # 稿件阅读&标注
│   │   │   ├── discussions/    # 讨论区
│   │   │   ├── reviews/        # 审稿中心
│   │   │   └── continuity/     # 连续性追踪
│   │   └── api/
│   │       ├── projects/       # 项目CRUD
│   │       ├── agents/         # 触发agent任务
│   │       ├── discussions/    # 讨论API
│   │       └── reviews/        # 审稿API
│   ├── lib/
│   │   ├── agents/             # Agent调度 & context构建
│   │   ├── project/            # 项目状态机
│   │   └── llm.ts              # LLM调用层
│   └── components/
│
├── agents/                     # Python agent定义（从Mira迁移重型部分）
│   ├── roles/                  # 角色定义
│   │   ├── architect.md
│   │   ├── character.md
│   │   ├── writer.md
│   │   ├── editor.md
│   │   ├── continuity.md
│   │   ├── reader.md
│   │   ├── worldbuilder.md
│   │   ├── visual.md           # 剧本专用
│   │   ├── dialogue.md         # 剧本专用
│   │   └── coverage.md         # 剧本专用
│   ├── skills/                 # 从Mira迁移的写作skills
│   ├── frameworks/             # 从Mira迁移的写作框架
│   ├── checklists/             # 从Mira迁移的检查清单
│   └── prompts/                # 各phase的prompt模板
│
├── data/                       # 项目数据根目录
│   └── {project-slug}/        # 按上面的知识库结构
│
├── prisma/
│   └── schema.prisma           # 项目、讨论、reviews的DB schema
│
└── PLAN.md                     # 本文件
```

### 技术选型

- **前端**：Next.js + shadcn/ui（已有基础）
- **数据库**：SQLite + Prisma（项目元数据、讨论、状态）
- **内容存储**：文件系统markdown/json（稿件、bible、reviews）
- **LLM**：Anthropic SDK直接调用（已有），支持多模型
- **Agent层**：TypeScript为主（和app同语言），复杂任务可调Python

### 为什么不用Python agent

Mira的Python agent架构是为launchd定时任务设计的。神仙会是交互式app，需要：
- 实时反馈（streaming）
- UI直接触发agent
- 讨论的即时性

用TypeScript统一前后端，减少跨语言通信开销。Mira的写作skills/frameworks/checklists是markdown文件，直接复制过来即可。

---

## 开发路线图

### Phase 0: 基础设施（2-3周）
- [ ] 清理现有代码
- [ ] 项目数据模型 & Prisma schema
- [ ] 项目创建/管理基础API
- [ ] LLM调用层（streaming）
- [ ] Agent角色系统（角色定义加载、context构建）
- [ ] 基础UI：项目列表、项目概览

### Phase 1: 构思阶段可用（2-3周）
- [ ] Phase 1工作流实现（idea → logline → premise）
- [ ] 讨论机制 v1（agents讨论、人类插入、总结）
- [ ] 讨论UI
- [ ] 迁移Mira写作skills和frameworks
- [ ] 人类拍板流程

### Phase 2: 世界与角色（2-3周）
- [ ] Bible生成工作流
- [ ] 角色档案系统
- [ ] 角色关系可视化
- [ ] Bible浏览/编辑UI

### Phase 3: 结构设计（2-3周）
- [ ] 大纲生成工作流
- [ ] 场景卡系统
- [ ] 张力曲线可视化
- [ ] 结构视图UI

### Phase 4: 写作引擎（3-4周）
- [ ] 逐章写作工作流
- [ ] 上下文窗口动态组装
- [ ] 连续性追踪系统
- [ ] 章节review流程
- [ ] 稿件阅读/标注UI

### Phase 5: 审稿与修改（2-3周）
- [ ] 多维度审稿工作流
- [ ] Issue追踪系统
- [ ] 修改工作流
- [ ] 审稿中心UI

### Phase 6: 剧本支持（2-3周）
- [ ] 剧本专用角色（visual、dialogue、coverage）
- [ ] 剧本格式支持
- [ ] 剧本特有的结构视图（序列、场景）

### Phase 7: 打磨（持续）
- [ ] 性能优化
- [ ] 导出功能
- [ ] 多项目管理
- [ ] 历史版本对比

---

## 设计原则

1. **人类是showrunner**：任何phase的推进都需要人类拍板。agents可以主动讨论、提建议，但不能自己决定方向。

2. **讨论可见**：agent不是黑箱。所有思考、讨论、分歧都在app中可见。人类可以随时翻看"他们在聊什么"。

3. **渐进式精度**：从粗到细。先有logline再有大纲，先有大纲再有草稿。不跳步。

4. **上下文精确**：不暴力塞context。每个agent每次调用只拿到它需要的信息切片。

5. **可回溯**：任何阶段都可以回退。改了角色设定，能追踪影响到哪些章节。

6. **先能跑，再好看**：功能优先于UI美观。先实现工作流，再打磨体验。
