// CKP 评审 v3.0 — AI 评审字段（评论级 AI 评审结果）
// 来源：用户决策 Q4/AI 模块 - Docmost fork 接入 ai_pool_shared（51AC:18028）
// 时机：评论创建后异步触发，写回此字段；前端可看到 AI 评审建议
// 设计：每条评论独立 AI 评审结果，独立触发，避免评审 session 整体被污染

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // AI 评审状态
  await db.schema
    .alterTable('comments')
    .addColumn('ai_review_status', 'varchar', (col) =>
      col.notNull().defaultTo('pending'),
    )  // pending / reviewing / completed / failed / skipped
    .execute();

  // AI 评审建议（结构化 JSON，与 51AC:18028/api/ai/review 返回一致）
  await db.schema
    .alterTable('comments')
    .addColumn('ai_review_suggestion', 'jsonb', (col) => col)
    .execute();
  // ai_review_suggestion 结构: { issue_type, severity, summary, detail, suggestion, ref_standards, confidence }

  // AI 评审实际使用的账号
  await db.schema
    .alterTable('comments')
    .addColumn('ai_review_account', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`),
    )
    .execute();
  // ai_review_account 结构: { provider, model, account_index }

  // AI 评审时间戳
  await db.schema
    .alterTable('comments')
    .addColumn('ai_reviewed_at', 'timestamptz', (col) => col)
    .execute();

  // 触发标记：避免重复触发（如果某条评论被反复编辑）
  await db.schema
    .alterTable('comments')
    .addColumn('ai_review_hash', 'varchar', (col) => col)
    .execute();
  // 存评论内容 + selection 的 SHA1，重复时跳过 AI 调用

  await db.schema
    .createIndex('comments_ai_review_status_idx')
    .on('comments')
    .column('ai_review_status')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('comments').dropIndex('comments_ai_review_status_idx').execute();
  await db.schema.alterTable('comments').dropColumn('ai_review_hash').execute();
  await db.schema.alterTable('comments').dropColumn('ai_reviewed_at').execute();
  await db.schema.alterTable('comments').dropColumn('ai_review_account').execute();
  await db.schema.alterTable('comments').dropColumn('ai_review_suggestion').execute();
  await db.schema.alterTable('comments').dropColumn('ai_review_status').execute();
}
