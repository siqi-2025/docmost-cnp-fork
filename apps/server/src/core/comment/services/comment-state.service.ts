import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { Kysely } from 'kysely';
import { KyselyDB, KyselyTransaction } from '../../../database/types/kysely.types';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../page/page-access/page-access.service';
import { WsService } from '../../../ws/ws.service';
import { User } from '@docmost/db/types/entity.types';
import { executeTx } from '../../../database/utils';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { sql } from 'kysely';
import { CommentState, CommentStateValue } from '../dto/comment-state.dto';

/**
 * CKP 评审 v3.0 — 评论 4 态状态机服务
 *
 * 设计要点：
 *   - 状态机规则由 {@link canTransition} 集中定义，service/handler 都通过它校验。
 *   - 每次迁移在一个事务里：
 *       1) 校验 from→to 合法
 *       2) 校验权限（评论创建者或 space 管理员可执行；reopen/close 视场景稍放宽）
 *       3) UPDATE comments SET state, state_changed_by, state_changed_at, state_reason
 *       4) INSERT comment_state_history(from_state, to_state, changed_by, reason)
 *   - 历史表采用 append-only 审计；不允许 UPDATE/DELETE 历史（应用层不暴露）。
 *   - 所有 DB 操作通过 Kysely 查询构造器，**不**写 raw SQL。
 *   - 类型层：新增的 comments.state/stateChangedBy/stateChangedAt/stateReason
 *     + commentStateHistory 表在 kysely-codegen 跑过之前不进入 DB 接口，
 *     因此本服务在执行查询时使用 Kysely<any> 的窄作用域绕过类型缺失，
 *     列名仍以 snake_case 直接出现在构造器里（与现有 migrations 对齐）。
 */
@Injectable()
export class CommentStateService {
  private readonly logger = new Logger(CommentStateService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly commentRepo: CommentRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly wsService: WsService,
  ) {}

  /**
   * 状态迁移规则：
   *   open     → {accepted, rejected, closed}
   *   accepted → {open, closed}
   *   rejected → {open, closed}
   *   closed   → {open}            （软终结，可 reopen 回 open）
   */
  static canTransition(
    from: CommentStateValue | string | null | undefined,
    to: CommentStateValue | string,
  ): boolean {
    const allowed: Record<string, readonly string[]> = {
      [CommentState.Open]: [CommentState.Accepted, CommentState.Rejected, CommentState.Closed],
      [CommentState.Accepted]: [CommentState.Open, CommentState.Closed],
      [CommentState.Rejected]: [CommentState.Open, CommentState.Closed],
      [CommentState.Closed]: [CommentState.Open],
    };
    const fromKey = from ?? CommentState.Open;
    const allowedTo = allowed[fromKey] ?? [];
    return allowedTo.includes(to);
  }

  /**
   * 校验 + 执行迁移。
   * @param commentId 评论 UUID
   * @param fromState 当前状态（来自请求方读到的快照，用于乐观校验）
   * @param toState 目标状态
   * @param userId 执行迁移的用户
   * @param reason 迁移原因（可选）
   */
  async transition(
    commentId: string,
    fromState: CommentStateValue | string,
    toState: CommentStateValue,
    userId: string,
    reason?: string,
  ): Promise<{ id: string; state: CommentStateValue; stateChangedAt: Date }> {
    if (!CommentStateService.canTransition(fromState, toState)) {
      throw new BadRequestException(
        `Invalid comment state transition: ${fromState} -> ${toState}`,
      );
    }

    const comment = await this.commentRepo.findById(commentId);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const page = await this.pageRepo.findById(comment.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.assertCanChangeState(page.id, userId);

    // 与 DB 实际状态再次校验（防止前端传 fromState 过时）
    if ((comment as any).state && (comment as any).state !== fromState) {
      throw new BadRequestException(
        `Comment state has changed since read: expected=${fromState}, actual=${(comment as any).state}`,
      );
    }

    const now = new Date();
    const result = await executeTx(this.db, async (trx) => {
      // 1) 写主表
      const updated = await this.dbAny(trx)
        .updateTable('comments')
        .set({
          state: toState,
          stateChangedBy: userId,
          stateChangedAt: now,
          stateReason: reason ?? null,
          updatedAt: now,
        })
        .where('id', '=', commentId)
        .returning(['id', 'state', 'stateChangedAt'])
        .executeTakeFirst();

      if (!updated) {
        throw new NotFoundException('Comment not found');
      }

      // 2) 写审计
      await this.dbAny(trx)
        .insertInto('commentStateHistory')
        .values({
          commentId,
          fromState: String(fromState),
          toState,
          changedBy: userId,
          changedAt: now,
          reason: reason ?? null,
        })
        .execute();

      return updated as { id: string; state: string; stateChangedAt: Date };
    });

    // 3) WS 广播 — 不阻塞主流程
    try {
      this.wsService.emitCommentEvent(comment.spaceId, comment.pageId, {
        operation: 'commentStateChanged',
        pageId: comment.pageId,
        commentId,
        fromState,
        toState,
        stateChangedBy: userId,
        stateChangedAt: now.toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `ws broadcast failed for comment state change ${commentId}: ${(err as Error).message}`,
      );
    }

    return {
      id: result.id,
      state: result.state as CommentStateValue,
      stateChangedAt: result.stateChangedAt,
    };
  }

  /**
   * 权限校验：评论创建者本人或 space 管理员可改状态。
   * 简单实现：复用 pageAccessService 的 canComment 判定（任何能 comment 的人都是合法 reviewer）。
   * 若后续需要更细粒度（如只允许被指派人 accept），可在此扩展。
   */
  private async assertCanChangeState(pageId: string, userId: string): Promise<void> {
    const user: User = { id: userId } as User;
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    const workspaceId = page.workspaceId;
    try {
      await this.pageAccessService.validateCanComment(page, user, workspaceId);
    } catch (err) {
      throw new ForbiddenException(
        'You do not have permission to change comment state',
      );
    }
  }

  /**
   * 按状态筛选评论列表（针对某页）。
   * 通过 Kysely 构造器返回扁平 rows，不使用 raw SQL。
   */
  async listByState(
    pageId: string,
    state: CommentStateValue | undefined,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<Array<{ id: string; state: string; updatedAt: Date }>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let q = this.dbAny(this.db)
      .selectFrom('comments')
      .select(['id', 'state', 'updatedAt'])
      .where('pageId', '=', pageId)
      .orderBy('updatedAt', 'desc')
      .limit(limit);

    if (state) {
      q = q.where('state', '=', state);
    }
    if (opts.cursor) {
      q = q.where('updatedAt', '<', new Date(opts.cursor));
    }

    const rows = await q.execute();
    return rows.map((r: any) => ({
      id: r.id,
      state: r.state,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * 取某条评论的完整状态迁移历史（按时间倒序）。
   */
  async getStateHistory(commentId: string): Promise<
    Array<{
      id: string;
      fromState: string | null;
      toState: string;
      changedBy: string | null;
      changedAt: Date;
      reason: string | null;
      changedByUser?: { id: string; name: string; avatarUrl: string | null } | null;
    }>
  > {
    const rows = await this.dbAny(this.db)
      .selectFrom('commentStateHistory')
      .selectAll()
      .where('commentId', '=', commentId)
      .orderBy('changedAt', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: r.id,
      fromState: r.fromState ?? null,
      toState: r.toState,
      changedBy: r.changedBy ?? null,
      changedAt: r.changedAt,
      reason: r.reason ?? null,
    }));
  }

  /**
   * 列出某评论的迁移历史（带用户简要信息）。
   * 独立方法，避免 listByState 干扰。
   */
  async getStateHistoryWithActor(
    commentId: string,
  ): Promise<
    Array<{
      id: string;
      fromState: string | null;
      toState: string;
      changedBy: string | null;
      changedAt: Date;
      reason: string | null;
      actor: { id: string; name: string; avatarUrl: string | null } | null;
    }>
  > {
    const rows = await this.dbAny(this.db)
      .selectFrom('commentStateHistory as csh')
      .leftJoin('users', 'users.id', 'csh.changedBy')
      .select([
        'csh.id as id',
        'csh.fromState as fromState',
        'csh.toState as toState',
        'csh.changedBy as changedBy',
        'csh.changedAt as changedAt',
        'csh.reason as reason',
      ])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select(['users.id', 'users.name', 'users.avatarUrl'])
            .whereRef('users.id', '=', 'csh.changedBy'),
        ).as('actor'),
      )
      .where('csh.commentId', '=', commentId)
      .orderBy('csh.changedAt', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: r.id,
      fromState: r.fromState ?? null,
      toState: r.toState,
      changedBy: r.changedBy ?? null,
      changedAt: r.changedAt,
      reason: r.reason ?? null,
      actor: r.actor ?? null,
    }));
  }

  /**
   * 把 KyselyDB/KyselyTransaction 局部转成 Kysely<any> 以便查询新增字段/表
   * （直到 kysely-codegen 把 state/stateChangedAt/commentStateHistory 等加入 DB 类型）。
   */
  private dbAny(db: KyselyDB | KyselyTransaction): Kysely<any> {
    return db as unknown as Kysely<any>;
  }
}