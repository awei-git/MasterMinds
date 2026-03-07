<p align="center">
  <img src="public/logo.svg" alt="神仙会" width="400" />
</p>

<p align="center">
  <em>多智能体协作创意写作平台</em><br/>
  <sub>多个 AI agent 以圆桌讨论的形式，陪你从灵感到定稿，完成一部作品</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss" alt="Tailwind" />
  <img src="https://img.shields.io/badge/LLM-Claude%20%7C%20GPT%20%7C%20DeepSeek%20%7C%20Gemini-green" alt="LLM" />
</p>

---

## 工作方式

每个创作阶段有一组专业 agent 围坐讨论：

| 阶段 | 圆桌成员 | 做什么 |
|------|---------|--------|
| **构思** | 灵犀 + 鲁班 | 打磨核心冲突、主题、logline |
| **世界与角色** | 画皮 + 灵犀 + 鲁班 | 角色档案、世界观、规则 |
| **结构** | 鲁班 + 妙笔 + 铁面 | 节拍表、章节大纲、张力曲线 |
| **写作** | 妙笔 + 铁面 | 逐章写作，多模型择优 |
| **审稿** | 铁面 + 知音 + 妙笔 | 多轮审稿，频率检查 |
| **定稿** | 知音 + 铁面 | 第一读者体验，最终打磨 |

你说一句话，圆桌上所有 agent 依次发言。阶段完成时 agent 会提醒你推进。每个阶段可以生成总结，新阶段不用把全部历史对话塞进 context。

## Agent

> 每个 agent 配备专属写作技能（对话潜台词、心理距离、场景张力等），从 markdown 技能文件加载。

| | 名号 | 角色 | 专长 |
|---|------|------|------|
| 💡 | **灵犀** | Idea | 点子发散与收敛 |
| 🏗 | **鲁班** | Architect | 故事结构与节奏 |
| 🎭 | **画皮** | Character | 角色心理与声音 |
| ✍ | **妙笔** | Writer | 文笔与场景 |
| 📝 | **铁面** | Editor | 批判审稿与质控 |
| 📖 | **知音** | Reader | 第一读者视角 |

## 技术栈

- **Next.js** (App Router) + **Tailwind CSS v4**
- **Prisma** + **SQLite**
- **SSE** 流式响应
- 多模型支持：**Claude**、**GPT**、**DeepSeek**、**Gemini**

## 启动

```bash
pnpm install
cp .env.example .env
# 在 .env 中填入 API key

pnpm prisma db push
pnpm dev
```

## 功能

- **圆桌讨论** — 每条消息多个 agent 轮流回应
- **阶段推进** — agent 判断时机，建议进入下一阶段
- **阶段总结** — LLM 生成详细总结，新阶段用总结代替全量历史
- **Markdown 导入/导出** — 保存和加载对话记录
- **剪贴板** — 随手收藏 agent 的精彩片段
- **多模型切换** — Claude / GPT / DeepSeek / Gemini 随时切换

## 项目结构

```
src/
  app/
    api/
      chat/          — 消息 CRUD + 流式输出
      projects/      — 项目管理
      phases/        — 阶段总结生成
      clips/         — 剪贴板
    project/[slug]/  — 主聊天界面
  lib/
    agents/
      context.ts     — 构建 agent 上下文（技能、记忆、阶段总结）
      roles.ts       — 加载角色定义
    llm.ts           — 多模型 LLM 客户端
    db.ts            — Prisma 客户端
    project.ts       — 项目 CRUD
agents/
  roles/             — agent 角色定义（markdown）
  skills/            — 写作技能参考（markdown）
  frameworks/        — 按项目类型的写作框架
  checklists/        — 质量检查清单
data/                — 项目数据（gitignored）
```

## License

MIT
