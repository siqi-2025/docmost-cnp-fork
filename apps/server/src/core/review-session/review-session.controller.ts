import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '../../common/decorators/swagger-decorators';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { ReviewSessionService } from './review-session.service';
import { CkpResultDto } from '../comment/dto/comment-state.dto';
import {
  CkpCloseReviewSessionDto,
  CkpCreateReviewSessionDto,
  CkpListReviewSessionsQueryDto,
  CkpReviewSessionIdParamDto,
} from './dto/review-session.dto';

/**
 * CKP 评审 v3.0 — 评审批 HTTP 入口
 *
 * 路由：
 *   POST   /api/review-sessions               创建
 *   GET    /api/review-sessions?pageId=...    列表（按 page 过滤）
 *   GET    /api/review-sessions/:id           详情
 *   POST   /api/review-sessions/:id/close     关闭（可选附 summary）
 *
 * 与 Docmost 原生 /comments 等路径无冲突。
 */
@ApiTags('CKP Review Sessions')
@UseGuards(JwtAuthGuard)
@Controller('api/review-sessions')
export class ReviewSessionController {
  constructor(
    private readonly reviewSessionService: ReviewSessionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpCreateReviewSession',
    summary: 'CKP 创建评审批',
  })
  @ApiResponse({ status: 200, description: '创建成功' })
  @ApiResponse({ status: 403, description: '权限不足' })
  @ApiResponse({ status: 404, description: '页面不存在' })
  async create(
    @Body() dto: CkpCreateReviewSessionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<CkpResultDto<Record<string, unknown>>> {
    const row = await this.reviewSessionService.create(dto, user, workspace);
    return CkpResultDto.ok(row, 'Review session created');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpListReviewSessions',
    summary: 'CKP 评审批列表（按 page 过滤）',
  })
  @ApiResponse({ status: 200, description: '返回评审批数组' })
  async list(
    @Query() query: CkpListReviewSessionsQueryDto,
  ): Promise<CkpResultDto<Array<Record<string, unknown>>>> {
    const rows = await this.reviewSessionService.listByPageId(
      query.pageId,
      query.state,
    );
    return CkpResultDto.ok(rows);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpGetReviewSession',
    summary: 'CKP 评审批详情',
  })
  @ApiResponse({ status: 200, description: '返回评审批对象' })
  @ApiResponse({ status: 404, description: '评审批不存在' })
  async findOne(
    @Param() params: CkpReviewSessionIdParamDto,
  ): Promise<CkpResultDto<Record<string, unknown>>> {
    const row = await this.reviewSessionService.findOne(params.id);
    return CkpResultDto.ok(row);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'ckpCloseReviewSession',
    summary: 'CKP 关闭评审批（可附 summary）',
  })
  @ApiResponse({ status: 200, description: '关闭成功' })
  @ApiResponse({ status: 400, description: '已是终态' })
  @ApiResponse({ status: 403, description: '权限不足' })
  @ApiResponse({ status: 404, description: '评审批不存在' })
  async close(
    @Param() params: CkpReviewSessionIdParamDto,
    @Body() dto: CkpCloseReviewSessionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<CkpResultDto<Record<string, unknown>>> {
    const row = await this.reviewSessionService.close(
      params.id,
      user,
      workspace,
      dto,
    );
    return CkpResultDto.ok(row, 'Review session closed');
  }
}