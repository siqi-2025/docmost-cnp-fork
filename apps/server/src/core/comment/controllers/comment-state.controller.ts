import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '../../../common/decorators/swagger-decorators';
import { User } from '@docmost/db/types/entity.types';
import { CommentStateService } from '../services/comment-state.service';
import {
  CkpListCommentsQueryDto,
  CkpResultDto,
  CkpTransitionCommentStateBodyDto,
  CkpTransitionCommentStateParamDto,
  CommentState,
} from '../dto/comment-state.dto';

/**
 * CKP 评审 v3.0 — 评论状态机 HTTP 入口
 *
 * 设计原则：
 *   - 路径前缀 /api/comments 与 Docmost 原有 CommentController 一致，方法不冲突。
 *   - POST /api/comments/:id/state  —— 改状态（带权限 + 审计）
 *   - GET  /api/comments/:id/state-history —— 查历史（带 actor 信息）
 *   - GET  /api/comments?state=... —— 按状态筛选某页评论
 *
 * 注意：本 controller 行为是**叠加**在原 controller 上，原 POST /comments/create、
 * /comments/info、/comments/update、/comments/delete、POST /comments 均不变。
 */
@ApiTags('CKP Comments — State Machine')
@UseGuards(JwtAuthGuard)
@Controller('api/comments')
export class CommentStateController {
  constructor(
    private readonly commentStateService: CommentStateService,
  ) {}

  /**
   * 触发评论状态迁移
   *   POST /api/comments/:id/state
   *   body: { toState: "accepted"|"rejected"|"closed"|"open", reason?: string }
   *   响应：Result<{ id, state, stateChangedAt }>
   */
  @Post(':id/state')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpTransitionCommentState',
    summary: 'CKP 评论状态机迁移 (open/accepted/rejected/closed)',
  })
  @ApiResponse({
    status: 200,
    description: '迁移成功，写审计',
  })
  @ApiResponse({ status: 400, description: '非法状态迁移' })
  @ApiResponse({ status: 403, description: '权限不足' })
  @ApiResponse({ status: 404, description: '评论/页面不存在' })
  async transition(
    @Param() params: CkpTransitionCommentStateParamDto,
    @Body() body: CkpTransitionCommentStateBodyDto,
    @AuthUser() user: User,
  ): Promise<CkpResultDto<{ id: string; state: string; stateChangedAt: Date }>> {
    const commentId = params.id;
    const fromState = await this.readCurrentState(commentId);
    const updated = await this.commentStateService.transition(
      commentId,
      fromState,
      body.toState,
      user.id,
      body.reason,
    );
    return CkpResultDto.ok(updated, `Comment state -> ${body.toState}`);
  }

  /**
   * 查评论状态迁移历史
   *   GET /api/comments/:id/state-history
   */
  @Get(':id/state-history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpGetCommentStateHistory',
    summary: 'CKP 评论状态机迁移历史',
  })
  @ApiResponse({ status: 200, description: '返回按时间倒序的历史数组' })
  @ApiResponse({ status: 404, description: '评论不存在' })
  async stateHistory(
    @Param() params: CkpTransitionCommentStateParamDto,
  ): Promise<CkpResultDto<unknown[]>> {
    const rows = await this.commentStateService.getStateHistoryWithActor(
      params.id,
    );
    return CkpResultDto.ok(rows);
  }

  /**
   * 按状态筛选某页评论
   *   GET /api/comments?pageId=...&state=open&limit=50
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpListCommentsByState',
    summary: 'CKP 按状态筛选评论',
  })
  @ApiResponse({ status: 200, description: '返回评论摘要列表' })
  async listByState(
    @Query() query: CkpListCommentsQueryDto,
  ): Promise<CkpResultDto<unknown[]>> {
    const rows = await this.commentStateService.listByState(
      query.pageId,
      query.state,
      { limit: query.limit, cursor: query.cursor },
    );
    return CkpResultDto.ok(rows);
  }

  /**
   * 读取评论当前 state — 通过 CommentRepo.findById。
   * 字段 state 在 codegen 跑过之前没有显式类型，cast 兜底。
   */
  private async readCurrentState(commentId: string): Promise<string> {
    const comment = await this.commentStateService[
      'commentRepo'
    ].findById(commentId);
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    const current = (comment as any).state;
    if (!current) {
      // 新装库但还没 codegen 时，state 字段为 undefined，按 open 处理
      return CommentState.Open;
    }
    return current as string;
  }
}