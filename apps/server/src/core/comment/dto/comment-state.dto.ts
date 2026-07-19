import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * CKP 评审 v3.0 — 评论 4 态状态机枚举
 *
 * 状态迁移规则（见 CommentStateService.canTransition）：
 *   open     → accepted | rejected | closed
 *   accepted → open     | closed
 *   rejected → open     | closed
 *   closed   → open              （软终结，可 reopen）
 */
export enum CommentState {
  Open = 'open',
  Accepted = 'accepted',
  Rejected = 'rejected',
  Closed = 'closed',
}

export const COMMENT_STATES: readonly CommentState[] = [
  CommentState.Open,
  CommentState.Accepted,
  CommentState.Rejected,
  CommentState.Closed,
] as const;

export type CommentStateValue = (typeof COMMENT_STATES)[number];

/**
 * POST /api/comments/:id/state  —— 触发状态迁移
 * 仅用于路由参数 commentId 的 DTO，body 是 TransitionCommentStateBody。
 */
export class CkpTransitionCommentStateParamDto {
  @IsUUID()
  id: string;
}

/**
 * POST /api/comments/:id/state  —— body
 *
 * 注意：commentId 来自 URL path param，因此 body 不再重复声明。
 */
export class CkpTransitionCommentStateBodyDto {
  @IsIn(COMMENT_STATES as unknown as string[])
  toState: CommentStateValue;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

/**
 * GET /api/comments?state=... —— 查询参数
 * 与原 CommentController.findPageComments 的 body(PageIdDto + PaginationOptions) 协议不冲突，
 * 因为此处用 query string。
 */
export class CkpListCommentsQueryDto {
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsIn(COMMENT_STATES as unknown as string[])
  state?: CommentStateValue;

  @IsOptional()
  limit?: number;

  @IsOptional()
  cursor?: string;
}

/**
 * 通用 Result<T> 包装 — CKP 项目铁律要求所有 controller 出参统一形态。
 * code=0 成功，code!=0 失败；data 与 message 二选一必有。
 */
export class CkpResultDto<T> {
  code: number;
  message?: string;
  data?: T;

  static ok<T>(data: T, message?: string): CkpResultDto<T> {
    const r = new CkpResultDto<T>();
    r.code = 0;
    r.message = message;
    r.data = data;
    return r;
  }

  static fail<T = never>(code: number, message: string): CkpResultDto<T> {
    const r = new CkpResultDto<T>();
    r.code = code;
    r.message = message;
    return r;
  }
}