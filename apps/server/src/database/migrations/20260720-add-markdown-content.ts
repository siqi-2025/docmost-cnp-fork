// CKP 评审 v3.0 — Markdown 源内容
// 来源：用户决策 Q6 — 默认 TipTap，可切换到 Markdown 编辑

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // pages.content 是 JSONB (TipTap)，新增 markdown_content TEXT 用于双向同步
  await db.schema
    .alterTable('pages')
    .addColumn('markdown_content', 'text', (col) => col)
    .execute();

  // 标记当前编辑器偏好
  await db.schema
    .alterTable('pages')
    .addColumn('editor_mode', 'varchar', (col) =>
      col.notNull().defaultTo('wysiwyg'),
    )  // wysiwyg / markdown
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('pages').dropColumn('editor_mode').execute();
  await db.schema.alterTable('pages').dropColumn('markdown_content').execute();
}