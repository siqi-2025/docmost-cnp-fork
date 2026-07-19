import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { Kysely } from 'kysely';
import { KyselyDB, KyselyTransaction } from '../../database/types/kysely.types';
import { executeTx } from '../../database/utils';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../page/page-access/page-access.service';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { ReviewSessionRepo } from './review-session.repo';
import { WsService } from '../../ws/ws.service';
import {
  CkpCloseReviewSessionDto,
  CkpCreateReviewSessionDto,
  ReviewSessionState,
} from './dto/review-session.dto';

/**
 * CKP 评审 v3.0 — 评审批业务逻辑
 *
 * 状态机：
 *   open        —— 评审进行中
 *   submitted   —— 提交评审
 *   aggregated  —— AI 总结已生成
 *   closed      —— 已关闭（终态）
 *
 * 关闭流程（POST /api/review-sessions/:id/close）：
 *   1) 校验所有权（启动人或 space 管理员）
 *   2) 事务内 UPDATE review_sessions SET state='closed', closed_at=now
 *   3) 可选：异步触发 AI 总结（Phase 2；当前版本仅写 summary 字段，不调 ai_pool）
 */
@Injectable()
export class ReviewSessionService {
  private readonly logger = new Logger(ReviewSessionService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly reviewSessionRepo: ReviewSessionRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly wsService: WsService,
  ) {}

  async create(
    dto: CkpCreateReviewSessionDto,
    user: User,
    workspace: Workspace,
  ): Promise<Record<string, unknown>> {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.assertCanReview(page.id, user, workspace.id);

    const now = new Date();
    const created = await executeTx(this.db, async (trx) => {
      const row = await this.reviewSessionRepo.insertSession(
        {
          pageId: dto.pageId,
          title: dto.title ?? null,
          description: dto.description ?? null,
          targetVersionId: dto.targetVersionId ?? null,
          startedBy: user.id,
          startedAt: now,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          invitedUserIds: dto.invitedUserIds ?? [],
          workspaceId: workspace.id,
          spaceId: page.spaceId,
          state: ReviewSessionState.Open,
          createdAt: now,
          updatedAt: now,
        },
        trx,
      );
      return row;
    });

    try {
      this.wsService.emitCommentEvent(page.spaceId, page.id, {
        operation: 'reviewSessionCreated',
        pageId: page.id,
        reviewSession: created,
      });
    } catch (err) {
      this.logger.warn(
        `ws broadcast failed for review session ${created?.id}: ${(err as Error).message}`,
      );
    }

    return created;
  }

  async listByPageId(
    pageId: string,
    state?: string,
    opts: { limit?: number } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    return this.reviewSessionRepo.listByPageId(pageId, state, opts);
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    const row = await this.reviewSessionRepo.findById(id);
    if (!row) {
      throw new NotFoundException('Review session not found');
    }
    return row;
  }

  /**
   * 关闭评审批。
   * Phase 2 计划：异步入队 REVIEW_SESSION_AI_SUMMARY，调 51AC:18028/api/ai/summarize。
   * 当前实现：直接写 closed_at + ai_summary_markdown，AI 总结留给前端触发或后续 PR。
   */
  async close(
    id: string,
    user: User,
    workspace: Workspace,
    dto: CkpCloseReviewSessionDto,
  ): Promise<Record<string, unknown>> {
    const row = await this.reviewSessionRepo.findById(id);
    if (!row) {
      throw new NotFoundException('Review session not found');
    }
    const pageId = row.pageId as string;
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.assertCanReview(pageId, user, workspace.id);

    const currentState = (row.state as string) ?? ReviewSessionState.Open;
    if (currentState === ReviewSessionState.Closed) {
      throw new BadRequestException('Review session is already closed');
    }

    const updated = await executeTx(this.db, async (trx) => {
      const result = await this.reviewSessionRepo.softClose(
        id,
        dto.summary ?? null,
      );
      return result;
    });

    try {
      this.wsService.emitCommentEvent(page.spaceId, page.id, {
        operation: 'reviewSessionClosed',
        pageId: page.id,
        reviewSession: updated,
      });
    } catch (err) {
      this.logger.warn(
        `ws broadcast failed for review session close ${id}: ${(err as Error).message}`,
      );
    }

    return updated;
  }

  private async assertCanReview(
    pageId: string,
    user: User,
    workspaceId: string,
  ): Promise<void> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    try {
      await this.pageAccessService.validateCanComment(page, user, workspaceId);
    } catch (err) {
      throw new ForbiddenException(
        'You do not have permission to manage review sessions',
      );
    }
  }
}