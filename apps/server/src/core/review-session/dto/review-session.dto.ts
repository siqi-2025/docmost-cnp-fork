import { IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * CKP 评审 v3.0 — 评审批状态枚举
 *
 *   open        —— 评审进行中，可接受评论
 *   submitted   —— 提交评审（全部 comment 已采纳/拒绝/关闭），等待聚合
 *   aggregated  —— AI 总结已生成（或用户跳过），可关闭
 *   closed      —— 已关闭（终态）
 */
export enum ReviewSessionState {
  Open = 'open',
  Submitted = 'submitted',
  Aggregated = 'aggregated',
  Closed = 'closed',
}

export const REVIEW_SESSION_STATES: readonly ReviewSessionState[] = [
  ReviewSessionState.Open,
  ReviewSessionState.Submitted,
  ReviewSessionState.Aggregated,
  ReviewSessionState.Closed,
] as const;

export type ReviewSessionStateValue =
  (typeof REVIEW_SESSION_STATES)[number];

/**
 * POST /api/review-sessions  body
 */
export class CkpCreateReviewSessionDto {
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  targetVersionId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  invitedUserIds?: string[];

  @IsOptional()
  @IsString()
  deadline?: string;
}

/**
 * GET /api/review-sessions?pageId=...  query
 */
export class CkpListReviewSessionsQueryDto {
  @IsUUID()
  pageId: string;

  @IsOptional()
  state?: ReviewSessionStateValue;
}

/**
 * POST /api/review-sessions/:id/close  body
 */
export class CkpCloseReviewSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skippedSummary?: boolean;
}

/**
 * 评论 ID 路径参数（用于评论和评审批绑定场景，可选扩展）
 */
export class CkpReviewSessionIdParamDto {
  @IsUUID()
  id: string;
}