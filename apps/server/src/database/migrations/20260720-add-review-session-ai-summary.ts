// CKP 评审 v3.0 — 评审批 AI 总结字段
// 来源：评审批关闭时调 51AC:18028/api/ai/summarize，结果写回 review_sessions 行

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('review_sessions')
    .addColumn('ai_summary_status', 'varchar', (col) =>
      col.notNull().defaultTo('pending'),
    )  // pending / running / completed / failed / skipped
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
  await db.schema.alterTable('review_sessions').dropColumn('ai_summarized_at').execute();
  await db.schema.alterTable('review_sessions').dropColumn('ai_summary_account').execute();
  await db.schema.alterTable('review_sessions').dropColumn('ai_summary_markdown').execute();
  await db.schema.alterTable('review_sessions').dropColumn('ai_summary_status').execute();
}
