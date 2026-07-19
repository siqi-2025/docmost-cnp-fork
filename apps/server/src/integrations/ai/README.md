# CKP 评审 v3.0 — Docmost fork AI 模块接入说明

> 与 51AC:18028 ai_pool 微服务桥接；评论创建后异步触发 AI 评审，写回 `comments` 表字段。

---

## 架构总览

```
┌──────────────────────┐                          ┌──────────────────────────┐
│ Docmost (NestJS 后端) │                          │ 51AC:18028 ai_pool 微服务 │
│                      │                          │                          │
│  CommentService      │  同步评论入库 + 发 WS 事件 │  /api/ai/review           │
│       │              │                          │  /api/ai/summarize        │
│       ↓              │                          │  /api/ai/suggest-fix      │
│  AiReviewEmitter     │─── 入队 GENERAL_QUEUE ───▶│  /api/ai/audit            │
│       │              │                          │       │                   │
│       ↓              │                          │       ↓                    │
│  GENERAL_QUEUE       │  异步 BullMQ Worker       │  ai_pool_shared.AIPool    │
│       │              │                          │  (minimax / kimi / GLM)   │
│       ↓              │                          │                          │
│  AiReviewProcessor   │  HTTP POST /api/ai/review │                          │
│       │              │                          │                          │
│       ↓              │                          │                          │
│  comments 表         │  写回 ai_review_* 字段    │                          │
│  ·ai_review_status   │                          │                          │
│  ·ai_review_suggestion                         │                          │
│  ·ai_review_account │                          │                          │
│  ·ai_reviewed_at    │                          │                          │
└──────────────────────┘                          └──────────────────────────┘
```

特性：
- **非阻塞**：评论主流程 `await commentRepo.insertComment()` 完成后立刻返回；AI 评审走队列。
- **失败不抛**：队列处理器失败落 `ai_review_status='failed'` + 详情，前端可重试或隐藏。
- **可关闭**：`AI_POC_ENABLED=false` 环境变量一键关闭模块。
- **可观测**：`/healthz` 不暴露；通过 Prisma SQL `WHERE ai_review_status='failed'` 看积压。

---

## 新增/修改文件清单

### 新增（fork 端）

| 路径 | 行数 | 说明 |
|------|------|------|
| `apps/server/src/integrations/ai/ai.types.ts` | 101 | 类型契约，对齐 18028 JSON |
| `apps/server/src/integrations/ai/ai.client.ts` | 188 | HTTP 客户端（@nestjs/axios） |
| `apps/server/src/integrations/ai/ai-review.emitter.ts` | 76 | 评论入队触发器 |
| `apps/server/src/integrations/ai/ai-review.processor.ts` | 123 | 队列监听器 + 写回 DB |
| `apps/server/src/integrations/ai/ai.module.ts` | 40 | NestJS 模块定义 + DI 容器 |
| `apps/server/src/integrations/ai/index.ts` | 9 | re-export |
| `apps/server/src/database/migrations/20260720-add-comment-ai-review.ts` | 70 | comments 表加 AI 字段 |
| `apps/server/src/database/migrations/20260720-add-review-session-ai-summary.ts` | 35 | review_sessions 表加总结字段 |

### 修改

| 路径 | 改动 |
|------|------|
| `apps/server/src/integrations/queue/constants/queue.constants.ts` | +2 个 QueueJob 常量 |
| `apps/server/src/core/comment/comment.module.ts` | imports 加 `AiModule` |
| `apps/server/src/core/comment/comment.service.ts` | constructor 注入 emitter + create() 末尾 emit |
| `.env.example` | +3 个 AI_POC_* 环境变量 |

---

## 数据模型

### `comments` 表新增字段（迁移 `20260720-add-comment-ai-review`）

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `ai_review_status` | varchar | `'pending'` | pending / reviewing / completed / failed / skipped |
| `ai_review_suggestion` | jsonb | NULL | 结构化 AI 评审结果 |
| `ai_review_account` | jsonb | `{}` | {provider, model, account_index, input_tokens, output_tokens} |
| `ai_reviewed_at` | timestamptz | NULL | 评审完成时间 |
| `ai_review_hash` | varchar | NULL | 评论内容 SHA1，重复触发跳过 |

索引：`comments_ai_review_status_idx`。

### `review_sessions` 表新增字段（迁移 `20260720-add-review-session-ai-summary`）

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `ai_summary_status` | varchar | `'pending'` | pending / running / completed / failed |
| `ai_summary_markdown` | text | NULL | AI 总结全文 |
| `ai_summary_account` | jsonb | `{}` | 实际调用账号 |
| `ai_summarized_at` | timestamptz | NULL | 总结时间 |

---

## 环境变量

```bash
# 51AC AI POC 微服务地址
AI_POC_URL=http://116.204.12.137:18028
AI_POC_TIMEOUT=30          # 秒，单次请求超时
AI_POC_ENABLED=true        # 总开关，false 时整个模块静默返回
```

---

## 队列

`QueueName.GENERAL_QUEUE`（Docmost 现有通用队列，**复用**，不新建 queue）
新增 job 名：
- `comment-ai-review` — 评论级 AI 评审
- `review-session-ai-summary` — 评审批 AI 总结（**待阶段 2 实现**，本 PR 不含 controller）

Concurrency：`3`（processor 注解里设置，防止 OOM）。

---

## 业务流程

### 评论创建时

```
User 在 TipTap 选中文字
       ↓
Frontend POST /api/comments → CommentService.create()
       ↓
       1. commentRepo.insertComment()          (sync)
       2. collaborationGateway.handleYjsEvent (sync)
       3. generalQueue.add(ADD_PAGE_WATCHERS) (async fire-and-forget)
       4. notificationQueue.add(...)           (async)
       5. wsService.emitCommentEvent (sync, push to connected clients)
       6. aiReviewEmitter.emitCommentAiReview  (async fire-and-forget)  ← 新增
       ↓
   return comment
       ↓
   ← CommentAiReviewJob 进入 GENERAL_QUEUE
       ↓
   ↓ (异步)
       AiReviewProcessor.process() 调 18028 /api/ai/review
       ↓
       写回 comments.ai_review_*
```

### 失败处理

| 阶段 | 失败行为 | DB 状态 |
|------|---------|---------|
| HTTP 调用 5xx/timeout | retry 2 次（指数退避 5s） | 最终落 `failed`，前端可看 |
| HTTP 调用 4xx | 不重试，直接落 `failed` | `ai_review_suggestion={error: msg}` |
| AI 服务未配置（pool_configured=false） | 立即返回 `503`，processor 落 `failed` | — |
| `AI_POC_ENABLED=false` | emitter 直接 warn，processor 不入队 | 评论原样入库，无 AI 字段 |

---

## 调用示例

### 同步评审 API（直接调 AI POC 对照）

```bash
curl -X POST http://116.204.12.137:18028/api/ai/review \
  -H 'Content-Type: application/json' \
  -d '{"selection": "图看不清", "context": "5.1 系统功能分解", "reviewMode": "URS"}'
```

### 看评论的 AI 评审结果（Docmost 自身 API）

```sql
SELECT id, ai_review_status, ai_review_suggestion->>'severity' as severity,
       ai_review_suggestion->>'summary' as summary, ai_reviewed_at
FROM comments
WHERE ai_review_status = 'completed'
ORDER BY ai_reviewed_at DESC LIMIT 20;
```

### 监控队列积压

```bash
# Docmost 部署后看 Redis
redis-cli -h 51AC LLEN bull:{general-queue}:waiting
redis-cli -h 51AC ZCARD bull:{general-queue}:failed
```

---

## 阶段 2 TODO（不在本 PR 范围）

- [ ] `AiSummaryController` —— review session 关闭时调 `/api/ai/summarize`
- [ ] `/api/ai/review?provider=kimi` 透传：前端给"指定供应商"按钮
- [ ] 前端 React 组件 `CommentAiBadge.tsx` —— 显示 severity icon + summary 折叠面板
- [ ] 批评审接口 —— 同时评审一篇页面的多条评论
- [ ] 评审历史 SLA（24h 内若未读 → 通知评审员）

---

## 验证步骤（铁律五 PDCA）

```bash
# 1. 装 Docmost 依赖
cd docmost-fork && pnpm install

# 2. 跑迁移（数据库）
cd apps/server && pnpm migration:latest

# 3. 类型检查
pnpm build

# 4. 启动
pnpm start:dev

# 5. 创建评论触发 AI
curl -X POST http://localhost:3000/api/comments \
  -H "Authorization: Bearer <token>" \
  -d '{"pageId": "...", "content": "{\\"type\\":\\"doc\\"}", "selection": "测试段落"}'

# 6. 等 5-10s 看 ai_review_status
psql -c "SELECT id, ai_review_status, jsonb_pretty(ai_review_suggestion) FROM comments ORDER BY created_at DESC LIMIT 5;"
```

预期：前几条 `ai_review_status='pending'`，5-15 秒后变 `completed`，
`ai_review_suggestion` 含完整 7 个字段（issue_type/severity/summary/detail/suggestion/ref_standards/confidence）。
