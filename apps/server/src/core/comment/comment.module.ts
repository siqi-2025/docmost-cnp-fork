import { Module } from '@nestjs/common';
import { CommentService } from './comment.service';
import { CommentController } from './comment.controller';
import { CommentStateService } from './services/comment-state.service';
import { CommentStateController } from './controllers/comment-state.controller';
import { CollaborationModule } from '../../collaboration/collaboration.module';
import { AiModule } from '../../integrations/ai';

/**
 * CKP 评审 v3.0 — 评论模块（扩展）
 *
 * 新增：
 *   - CommentStateService / CommentStateController：4 态状态机迁移 + 历史
 *   - 不修改原 CommentService / CommentController 行为（AI 接入已 commit）
 */
@Module({
  imports: [CollaborationModule, AiModule],
  controllers: [CommentController, CommentStateController],
  providers: [CommentService, CommentStateService],
  exports: [CommentService, CommentStateService],
})
export class CommentModule {}