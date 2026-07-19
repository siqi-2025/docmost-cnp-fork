import { Module } from '@nestjs/common';
import { ReviewSessionController } from './review-session.controller';
import { ReviewSessionService } from './review-session.service';
import { ReviewSessionRepo } from './review-session.repo';

/**
 * CKP 评审 v3.0 — 评审批模块
 *
 * 设计：
 *   - ReviewSessionRepo 持有所有 Kysely 操作（含新表 reviewSessions，
 *     在 codegen 跑过之前以 Kysely<any> 局部绕过类型缺失）。
 *   - Service 暴露 CRUD + close（含事务 + WS 广播）。
 *   - Controller 暴露 /api/review-sessions 路由族。
 *
 * 与 CommentStateController 路径不同（/api/review-sessions vs /api/comments），
 * 不修改 Docmost 原生路由。
 */
@Module({
  imports: [],
  controllers: [ReviewSessionController],
  providers: [ReviewSessionService, ReviewSessionRepo],
  exports: [ReviewSessionService, ReviewSessionRepo],
})
export class ReviewSessionModule {}