// CKP 评审 v3.0 — 评论 4 态状态机 + 状态迁移历史
// 来源：用户决策 Q4 + R2 状态机

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 4 态状态机
  // - open: 待确认
  // - accepted: 已采纳
  // - rejected: 已拒绝
  // - closed: 已关闭（终态，可 reopen 回 open）
  await db.schema
    .alterTable('comments')
    .addColumn('state', 'varchar', (col) =>
      col.notNull().defaultTo('open'),
    )
    .execute();

  await db.schema
    .alterTable('comments')
    .addColumn('state_changed_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('comments')
    .addColumn('state_changed_at', 'timestamptz', (col) => col)
    .execute();

  await db.schema
    .alterTable('comments')
    .addColumn('state_reason', 'text', (col) => col)
    .execute();

  // 数据迁移：把 v2 status="通过" 映射为 accepted
  // 这是 Docmost 上线后第一次跑迁移时执行
  await db
    .updateTable('comments')
    .set({ state: 'accepted' })
    .where('state', '=', 'open')
    .where(eb => eb.or([
      eb('comments.type', '=', 'resolved'),
    ]))
    .execute();

  // 状态迁移历史审计
  await db.schema
    .createTable('comment_state_history')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('comment_id', 'uuid', (col) =>
      col.references('comments.id').onDelete('cascade').notNull(),
    )
    .addColumn('from_state', 'varchar', (col) => col)
    .addColumn('to_state', 'varchar', (col) => col.notNull())
    .addColumn('changed_by', 'uuid', (col) =>
      col.references('users.id').notNull(),
    )
    .addColumn('changed_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('reason', 'text', (col) => col)
    .execute();

  await db.schema
    .createIndex('comment_state_history_comment_idx')
    .on('comment_state_history')
    .column('comment_id')
    .execute();

  await db.schema
    .createIndex('comments_state_idx')
    .on('comments')
    .column('state')
    .execute();
}

/**
 * Down 必须保证 FK 干净地拆除，顺序：
 *   1) 拆 comments_state_idx 上的索引
 *   2) 显式 drop comment_state_history.comment_id -> comments.id 的 FK 约束
 *      （Postgres 默认在 dropTable 时级联删除，但先 dropConstraint 让语义清晰）
 *   3) dropTable('comment_state_history') —— 同时把 changed_by -> users.id FK 带走
 *   4) 显式 drop comments.state_changed_by -> users.id 的 FK
 *   5) dropColumn(state_reason/state_changed_at/state_changed_by/state)
 *
 * 约束名按 Postgres 默认约定 `<table>_<col1>_<col2>_..._<ref_table>_fkey`：
 *   - comment_state_history_comment_id_fkey
 *   - comment_state_history_changed_by_fkey
 *   - comments_state_changed_by_fkey  (注意：state_changed_by -> users)
 */
export async function down(db: Kysely<any>): Promise<void> {
  // 1) 拆 comments.state 上的索引
  await db.schema
    .alterTable('comments')
    .dropIndex('comments_state_idx')
    .execute();

  // 2) 显式 drop comment_state_history.comment_id 的 FK（防御性）
  await db.schema
    .alterTable('comment_state_history')
    .dropConstraint('comment_state_history_comment_id_fkey')
    .execute();

  // 3) 删 comment_state_history 表（连带 drop changed_by -> users 的 FK）
  await db.schema.dropTable('comment_state_history').execute();

  // 4) 显式 drop comments.state_changed_by 的 FK 后再 drop column
  await db.schema
    .alterTable('comments')
    .dropConstraint('comments_state_changed_by_fkey')
    .execute();

  // 5) drop columns (顺序无关，Postgres ALTER TABLE DROP COLUMN 一次提交即可)
  await db.schema.alterTable('comments').dropColumn('state_reason').execute();
  await db.schema.alterTable('comments').dropColumn('state_changed_at').execute();
  await db.schema.alterTable('comments').dropColumn('state_changed_by').execute();
  await db.schema.alterTable('comments').dropColumn('state').execute();
}