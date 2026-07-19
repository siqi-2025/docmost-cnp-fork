// CKP 评审 v3.0 — 通知 + SLA 提醒
// 来源：用户决策 Q10

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('notifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('type', 'varchar', (col) =>
      col.notNull(),  // sla_deadline / comment_mention / page_shared / ai_suggestion
    )
    .addColumn('title', 'varchar', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col)
    .addColumn('related_id', 'uuid', (col) => col)
    .addColumn('related_type', 'varchar', (col) =>
      // review_session / comment / page / ai_suggestion
      col,
    )
    .addColumn('read_at', 'timestamptz', (col) => col)
    .addColumn('email_sent_at', 'timestamptz', (col) => col)
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('notifications_user_idx')
    .on('notifications')
    .column('user_id')
    .execute();

  await db.schema
    .createIndex('notifications_user_unread_idx')
    .on('notifications')
    .columns(['user_id', 'read_at'])
    .execute();

  // 用户邮件偏好
  await db.schema
    .alterTable('users')
    .addColumn('email_notifications', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .execute();

  await db.schema
    .alterTable('users')
    .addColumn('notification_settings', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('notification_settings').execute();
  await db.schema.alterTable('users').dropColumn('email_notifications').execute();
  await db.schema.dropTable('notifications').execute();
}