/**
 * CKP 评审 v3.0 — AI 评审事件触发
 *
 * 提供 emitReviewRequest() 工具方法，供 comment.service.ts / page 服务调用。
 * 不侵入 comment.service.ts 业务代码 — call site 在新建 Comment 后调用此函数。
 *
 * 设计：通过事件订阅解耦，listener 监听 'comment.created' 事件后入队。
 *     监听器见 ai-review.listener.ts
 *
 * 当前 PR 范围：
 *   - 仅定义 trigger API（emitCommentAiReview）
 *   - 监听器订阅就绪（call site 通过 PR 后续添加到 comment.service.ts）
 *   - 集成方也可直接传 page.content 作为 context，避免 selection 太短
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../queue/constants';
import { CommentAiReviewJobData } from './ai-review.processor';

@Injectable()
export class AiReviewEmitter {
  private readonly logger = new Logger(AiReviewEmitter.name);

  constructor(
    @InjectQueue(QueueName.GENERAL_QUEUE)
    private readonly generalQueue: Queue,
  ) {}

  /**
   * 入队 AI 评审任务。
   * 调用方应在评论创建成功后立即调用，失败不抛（catch 内部已处理）。
   *
   * @param pageId     页面 ID（用于回查 context）
   * @param commentId  评论 ID（写回 ai_review_* 字段的锚点）
   * @param workspaceId 工作空间 ID（多租户隔离）
   * @param selection  用户选中的文本（如 paragraph，可空）
   * @param context    文档上下文段落（≥ 500 字符，可空）
   * @param reviewMode URS / FRS / TC / GENERAL，默认 GENERAL
   */
  async emitCommentAiReview(
    pageId: string,
    commentId: string,
    workspaceId: string,
    selection: string | undefined,
    context: string,
    reviewMode: 'URS' | 'FRS' | 'TC' | 'GENERAL' = 'GENERAL',
  ) {
    const jobData: CommentAiReviewJobData = {
      pageId,
      commentId,
      workspaceId,
      selection,
      context,
      reviewMode,
    };
    try {
      await this.generalQueue.add(
        QueueJob.COMMENT_AI_REVIEW,
        jobData,
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    } catch (e) {
      // 队列挂了不能让评论失败；只在 log 记录
      this.logger.warn(
        `Failed to queue AI review for comment ${commentId}: ${(e as Error).message}`,
      );
    }
  }
}
