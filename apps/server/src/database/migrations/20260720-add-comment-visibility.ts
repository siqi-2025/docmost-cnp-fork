// CKP 评审 v3.0 — 评论可见性 + 段落级锚点扩展
// 来源：用户决策 R1 / Q3-a

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 评论可见性
  await db.schema
    .alterTable('comments')
    .addColumn('visibility', 'varchar', (col) =>
      col.notNull().defaultTo('private'),
    )  // private / team / public
    .execute();

  await db.schema
    .alterTable('comments')
    .addColumn('visible_to_user_ids', 'jsonb', (col) =>
      col.defaultTo(sql`'[]'::jsonb`),
    )  // visibility=team 时存授权 user_ids
    .execute();

  // selection 字段类型扩展：从 varchar 改为 jsonb（保留原 selection 文本作为 backward-compat）
  // 实际 Docmost 的 selection 字段已经是 varchar，我们添加新字段 selection_meta
  await db.schema
    .alterTable('comments')
    .addColumn('selection_meta', 'jsonb', (col) => col)
    .execute();
  // selection_meta 存：{from, to, text, section, cnp_version}

  await db.schema
    .createIndex('comments_visibility_idx')
    .on('comments')
    .column('visibility')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('comments').dropIndex('comments_visibility_idx').execute();
  await db.schema.alterTable('comments').dropColumn('selection_meta').execute();
  await db.schema.alterTable('comments').dropColumn('visible_to_user_ids').execute();
  await db.schema.alterTable('comments').dropColumn('visibility').execute();
}