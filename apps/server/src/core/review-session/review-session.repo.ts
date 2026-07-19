import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { Kysely } from 'kysely';
import { KyselyDB, KyselyTransaction } from '../../database/types/kysely.types';
import { executeTx, dbOrTx } from '../../database/utils';
import { ReviewSessionState } from './dto/review-session.dto';

/**
 * CKP 评审 v3.0 — review_sessions 表 Kysely 封装
 *
 * 与 comment.repo 一致：使用 Kysely 查询构造器，**不**写 raw SQL。
 * 因为 review_sessions 表在 kysely-codegen 跑过之前还没有进入 DB 类型，
 * 本 repo 在执行查询处局部 cast 为 Kysely<any>，与 comment-state.service 同策略。
 */
@Injectable()
export class ReviewSessionRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private dbAny(db: KyselyDB | KyselyTransaction): Kysely<any> {
    return db as unknown as Kysely<any>;
  }

  async insertSession(
    values: Record<string, unknown>,
    trx?: KyselyTransaction,
  ): Promise<Record<string, unknown>> {
    const db = dbOrTx(this.db, trx);
    const inserted = await this.dbAny(db)
      .insertInto('reviewSessions')
      .values({
        ...values,
        state: (values.state as string) ?? ReviewSessionState.Open,
        invitedUserIds: (values.invitedUserIds as any) ?? [],
      })
      .returningAll()
      .executeTakeFirst();
    return (inserted ?? {}) as Record<string, unknown>;
  }

  async findById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<Record<string, unknown> | undefined> {
    const db = dbOrTx(this.db, trx);
    return this.dbAny(db)
      .selectFrom('reviewSessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async listByPageId(
    pageId: string,
    state?: string,
    opts: { limit?: number } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let q = this.dbAny(this.db)
      .selectFrom('reviewSessions')
      .selectAll()
      .where('pageId', '=', pageId)
      .orderBy('startedAt', 'desc')
      .limit(limit);

    if (state) {
      q = q.where('state', '=', state);
    }
    return q.execute();
  }

  async updateState(
    id: string,
    newState: string,
    patch: Record<string, unknown> = {},
    trx?: KyselyTransaction,
  ): Promise<Record<string, unknown>> {
    const db = dbOrTx(this.db, trx);
    const updated = await this.dbAny(db)
      .updateTable('reviewSessions')
      .set({
        state: newState,
        ...patch,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return (updated ?? {}) as Record<string, unknown>;
  }

  async softClose(
    id: string,
    summary?: string,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    return this.updateState(id, ReviewSessionState.Closed, {
      closedAt: now,
      aiSummaryMarkdown: summary ?? null,
    });
  }

  async countByState(
    pageId: string,
    state: string,
  ): Promise<number> {
    const row = await this.dbAny(this.db)
      .selectFrom('reviewSessions')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('pageId', '=', pageId)
      .where('state', '=', state)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}