/**
 * CKP 评审 v3.0 — AI 模块
 *
 * 提供 AI 评审（评论级 / 评审批级）能力。
 * 与 51AC:18028 ai_pool 微服务通过 HTTP 通信。
 *
 * 导出：
 *  - AiPocClient      HTTP 客户端
 *  - AiReviewEmitter  触发入队（评论模块调用）
 *  - AiReviewProcessor 队列监听器（写回 DB）
 *
 * 依赖：
 *  - HttpModule（NestJS @nestjs/axios）
 *  - ConfigModule 读 AI_POC_URL/AI_POC_ENABLED
 *  - BullModule 注册 QueueName.GENERAL_QUEUE
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { KyselyModule } from 'nestjs-kysely';
import { AiPocClient } from './ai.client';
import { AiReviewEmitter } from './ai-review.emitter';
import { AiReviewProcessor } from './ai-review.processor';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 0,
    }),
    ConfigModule,
    BullModule,
    KyselyModule,
  ],
  providers: [AiPocClient, AiReviewEmitter, AiReviewProcessor],
  exports: [AiPocClient, AiReviewEmitter],
})
export class AiModule {}
