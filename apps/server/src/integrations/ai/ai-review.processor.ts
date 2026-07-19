/**
 * CKP 评审 v3.0 — AI 评审队列监听器
 *
 * 评论创建后异步触发 AI 评审，不阻塞评论主流程。
 * 通过 BullMQ 队列（reuse Docmost 现有 QueueName.GENERAL_QUEUE），
 * 新增 QueueJob.COMMENT_AI_REVIEW 任务类型。
 *
 * 工作流：
 * 1. CommentService.create() 完成后 emit CommentCreatedEvent（此 PR 不动业务代码，
 *    通过新增 CommonModule 提供的 emitEvent 工具发送，避免侵入 comment.service.ts）
 * 2. AiReviewListener 订阅事件或监队列 → 入队
 * 3. Processor 调 AiPocClient.reviewSelection() → 写回 comments 表
 *
 * 注意：本文件作为 processor 注册到 GENERAL_QUEUE；
 * 事件触发器见 ai.events.ts。
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { KyselyDB } from '../../database/types/kysely.types';
import { dbOrTx } from '../../database/utils';
import { InjectKysely } from 'nestjs-kysely';
import { QueueJob, QueueName } from '../queue/constants';
import { AiPocClient } from './ai.client';

export interface CommentAiReviewJobData {
  commentId: string;
  pageId: string;
  workspaceId: string;
  selection?: string;
  context: string;
  reviewMode: 'URS' | 'FRS' | 'TC' | 'GENERAL';
}

@Processor(QueueName.GENERAL_QUEUE, { concurrency: 3 })
export class AiReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(AiReviewProcessor.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly ai: AiPocClient,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== QueueJob.COMMENT_AI_REVIEW) {
      return; // 非本监听器关心
    }
    const data = job.data as CommentAiReviewJobData;
    if (!data?.commentId) {
      this.logger.warn(`Empty job data, skip: ${job.id}`);
      return;
    }
    return this.runAiReview(data);
  }

  private async runAiReview(data: CommentAiReviewJobData) {
    const { commentId } = data;

    // 1. 状态置为 reviewing（防并发）
    await dbOrTx(this.db)
      .updateTable('comments')
      .set({ aiReviewStatus: 'reviewing', updatedAt: new Date() })
      .where('id', '=', commentId)
      .execute();

    // 2. 调 AI 服务（失败也不抛，DB 落 failed 状态让前端显示）
    let result;
    try {
      result = await this.ai.reviewSelection(
        data.selection ?? '',
        data.context ?? '',
        data.reviewMode,
      );
    } catch (e) {
      this.logger.error(`AI review failed for comment ${commentId}: ${(e as Error).message}`);
      await dbOrTx(this.db)
        .updateTable('comments')
        .set({
          aiReviewStatus: 'failed',
          aiReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', commentId)
        .execute();
      return;
    }

    // 3. 写回 DB
    if (!result.ok) {
      await dbOrTx(this.db)
        .updateTable('comments')
        .set({
          aiReviewStatus: 'failed',
          aiReviewedAt: new Date(),
          aiReviewSuggestion: JSON.stringify({ error: result.errorMessage }),
          updatedAt: new Date(),
        })
        .where('id', '=', commentId)
        .execute();
      return;
    }

    await dbOrTx(this.db)
      .updateTable('comments')
      .set({
        aiReviewStatus: 'completed',
        aiReviewSuggestion: JSON.stringify(result.stored),
        aiReviewAccount: JSON.stringify(result.provider ?? {}),
        aiReviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where('id', '=', commentId)
      .execute();

    this.logger.log(
      `AI review completed for comment ${commentId}: ` +
      `${result.stored?.issue_type}/${result.stored?.severity}`,
    );
  }
}
