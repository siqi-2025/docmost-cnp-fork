import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateCommentDto, yjsSelectionSchema } from './dto/create-comment.dto';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { Comment, Page, User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { extractUserMentionIdsFromJson } from '../../common/helpers/prosemirror/utils';
import { ICommentNotificationJob } from '../../integrations/queue/constants/queue.interface';
import { WsService } from '../../ws/ws.service';
import { AiReviewEmitter } from '../../integrations/ai';

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    private commentRepo: CommentRepo,
    private pageRepo: PageRepo,
    private wsService: WsService,
    private collaborationGateway: CollaborationGateway,
    @InjectQueue(QueueName.GENERAL_QUEUE)
    private generalQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private notificationQueue: Queue,
    private aiReviewEmitter: AiReviewEmitter,
  ) {}

  async findById(commentId: string) {
    const comment = await this.commentRepo.findById(commentId, {
      includeCreator: true,
      includeResolvedBy: true,
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  async create(
    opts: { page: Page; workspaceId: string; user: User },
    createCommentDto: CreateCommentDto,
  ) {
    const { page, workspaceId, user } = opts;
    const commentContent = JSON.parse(createCommentDto.content);

    if (createCommentDto.parentCommentId) {
      const parentComment = await this.commentRepo.findById(
        createCommentDto.parentCommentId,
      );

      if (!parentComment || parentComment.pageId !== page.id) {
        throw new BadRequestException('Parent comment not found');
      }

      if (parentComment.parentCommentId !== null) {
        throw new BadRequestException('You cannot reply to a reply');
      }
    }

    const inserted = await this.commentRepo.insertComment({
      pageId: page.id,
      content: commentContent,
      selection: createCommentDto?.selection?.substring(0, 250) ?? null,
      type: createCommentDto.type ?? 'page',
      parentCommentId: createCommentDto?.parentCommentId,
      creatorId: user.id,
      workspaceId: workspaceId,
      spaceId: page.spaceId,
    });

    if (createCommentDto.yjsSelection) {
      const parsed = yjsSelectionSchema.safeParse(createCommentDto.yjsSelection);
      if (!parsed.success) {
        this.logger.warn(
          `Invalid yjsSelection for comment ${inserted.id}: ${parsed.error.message}`,
        );
      } else {
        const documentName = `page.${page.id}`;
        try {
          await this.collaborationGateway.handleYjsEvent(
            'setCommentMark',
            documentName,
            {
              yjsSelection: parsed.data,
              commentId: inserted.id,
              resolved: false,
              user,
            },
          );
        } catch (error) {
          this.logger.warn(
            `Failed to apply comment mark for comment ${inserted.id}, comment saved without inline highlight`,
            error,
          );
        }
      }
    }

    const comment = await this.commentRepo.findById(inserted.id, {
      includeCreator: true,
      includeResolvedBy: true,
    });

    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [user.id],
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );

    const isReply = !!createCommentDto.parentCommentId;

    await this.queueCommentNotification(
      commentContent,
      [],
      comment.id,
      page.id,
      page.spaceId,
      workspaceId,
      user.id,
      !isReply,
      createCommentDto.parentCommentId,
    );

    this.wsService.emitCommentEvent(page.spaceId, page.id, {
      operation: 'commentCreated',
      pageId: page.id,
      comment,
    });

    // CKP 评审 v3.0 — 入队 AI 评审（异步，不阻塞 commentCreated 流程）
    // 失败仅 warn，绝不抛；前端若需显示 AI 状态可订阅 ai_review_status 字段
    const pageContext = this.extractPageContext(page);
    const reviewMode = this.inferReviewMode(page);
    const selectionText = this.commentContentAsText(commentContent);
    this.aiReviewEmitter
      .emitCommentAiReview(
        page.id,
        inserted.id,
        workspaceId,
        createCommentDto.selection ?? selectionText,
        pageContext,
        reviewMode,
      )
      .catch((err) =>
        this.logger.warn(`AI review emit failed for comment ${inserted.id}: ${err?.message}`),
      );

    return comment;
  }

  /**
   * 把 TipTap/ProseMirror JSON content 降级成纯文本短摘要（前 800 字符），用于 AI 评审 selection。
   */
  private commentContentAsText(content: any): string {
    try {
      const s = typeof content === 'string' ? content : JSON.stringify(content);
      const stripped = s.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
      return stripped.slice(0, 800);
    } catch {
      return '';
    }
  }

  /**
   * 提取页面纯文本（截前 3000 字符）作为 AI 评审上下文。
   * page.content 是 TipTap JSON 字符串，简单去掉标签保留可读部分。
   */
  private extractPageContext(page: Page): string {
    const raw = String(page.content ?? '');
    const stripped = raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\r\n]+/g, '\n')
      .replace(/\s{2,}/g, ' ');
    return stripped.slice(0, 3000);
  }

  /**
   * 简单识别评审模式：标题/路径含 URS / FRS / TC 关键字才传，否则默认 GENERAL。
   * 后续可扩展成 table-driven 或 workspace-level config。
   */
  private inferReviewMode(page: Page): 'URS' | 'FRS' | 'TC' | 'GENERAL' {
    // Page 类型没 slug 字段（pages 实体不带），仅以 title 为线索
    const hint = `${page.title ?? ''}`.toUpperCase();
    if (/\bURS\b|用户需求/.test(hint)) return 'URS';
    if (/\bFRS\b|功能需求/.test(hint)) return 'FRS';
    if (/\bTC\b|测试用例|TEST\s*CASE/.test(hint)) return 'TC';
    return 'GENERAL';
  }

  async findByPageId(
    pageId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Comment>> {
    const page = await this.pageRepo.findById(pageId);

    if (!page) {
      throw new BadRequestException('Page not found');
    }

    return this.commentRepo.findPageComments(pageId, pagination);
  }

  async update(
    comment: Comment,
    updateCommentDto: UpdateCommentDto,
    authUser: User,
  ): Promise<Comment> {
    const commentContent = JSON.parse(updateCommentDto.content);

    if (comment.creatorId !== authUser.id) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const oldMentionIds = extractUserMentionIdsFromJson(comment.content);

    const editedAt = new Date();

    await this.commentRepo.updateComment(
      {
        content: commentContent,
        editedAt: editedAt,
        updatedAt: editedAt,
      },
      comment.id,
    );

    await this.queueCommentNotification(
      commentContent,
      oldMentionIds,
      comment.id,
      comment.pageId,
      comment.spaceId,
      comment.workspaceId,
      authUser.id,
      false,
    );

    comment.content = commentContent;
    comment.editedAt = editedAt;
    comment.updatedAt = editedAt;

    this.wsService.emitCommentEvent(comment.spaceId, comment.pageId, {
      operation: 'commentUpdated',
      pageId: comment.pageId,
      comment,
    });

    return comment;
  }

  private async queueCommentNotification(
    content: any,
    oldMentionIds: string[],
    commentId: string,
    pageId: string,
    spaceId: string,
    workspaceId: string,
    actorId: string,
    notifyWatchers: boolean,
    parentCommentId?: string,
  ) {
    const mentionedUserIds = extractUserMentionIdsFromJson(content);
    const newMentionIds = mentionedUserIds.filter(
      (id) => id !== actorId && !oldMentionIds.includes(id),
    );

    if (newMentionIds.length === 0 && !notifyWatchers && !parentCommentId) return;

    const jobData: ICommentNotificationJob = {
      commentId,
      parentCommentId,
      pageId,
      spaceId,
      workspaceId,
      actorId,
      mentionedUserIds: newMentionIds,
      notifyWatchers,
    };

    await this.notificationQueue.add(
      QueueJob.COMMENT_NOTIFICATION,
      jobData,
    );
  }
}
