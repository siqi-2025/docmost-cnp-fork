// CKP 评审 v3.0 — 评审批 (review session)
// 来源：基于 2026-07-18 POC 验证 + 用户决策 Q5

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('review_sessions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('title', 'varchar', (col) => col)
    .addColumn('description', 'text', (col) => col)
    .addColumn('target_version_id', 'uuid', (col) =>
      col.references('page_history.id'),
    )
    .addColumn('started_by', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('started_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deadline', 'timestamptz', (col) => col)
    .addColumn('closed_at', 'timestamptz', (col) => col)
    .addColumn('state', 'varchar', (col) =>
      col.notNull().defaultTo('open'),  // open / submitted / aggregated / closed
    )
    .addColumn('invited_user_ids', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('review_sessions_page_idx')
    .on('review_sessions')
    .column('page_id')
    .execute();

  await db.schema
    .createIndex('review_sessions_state_idx')
    .on('review_sessions')
    .column('state')
    .execute();

  // 评论关联评审批
  await db.schema
    .alterTable('comments')
    .addColumn('review_session_id', 'uuid', (col) =>
      col.references('review_sessions.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('comments_review_session_idx')
    .on('comments')
    .column('review_session_id')
    .execute();

  // CKP 评审 v3.0 — 评审批 AI 总结字段（同迁移内合并，避免依赖循环）
  // 来源：评审批关闭时调 51AC:18028/api/ai/summarize，结果写回 review_sessions
  await db.schema
    .alterTable('review_sessions')
    .addColumn('ai_summary_status', 'varchar', (col) =>
      col.notNull().defaultTo('pending'),
    )  // pending / running / completed / failed
    .execute();

  await db.schema
    .alterTable('review_sessions')
    .addColumn('ai_summary_markdown', 'text', (col) => col)
    .execute();

  await db.schema
    .alterTable('review_sessions')
    .addColumn('ai_summary_account', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`),
    )
    .execute();
  // ai_summary_account 结构: { provider, model, account_index, input_tokens, output_tokens }

  await db.schema
    .alterTable('review_sessions')
    .addColumn('ai_summarized_at', 'timestamptz', (col) => col)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('comments').dropColumn('review_session_id').execute();
  await db.schema.dropTable('review_sessions').execute();
}